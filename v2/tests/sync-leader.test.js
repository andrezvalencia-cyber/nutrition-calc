// Node unit tests for sync-leader.js
// Run with: node tests/sync-leader.test.js
//
// Strategy: simulate a multi-tab environment in a single Node process by
// installing a shared in-process BroadcastChannel polyfill. Each "tab" loads
// the IIFE in its own VM-like sandbox by reusing the same global with reset
// between tests via SyncLeader._resetForTest().
//
// Because we have one process per test, simulating two distinct tabs requires
// either (a) loading the module twice into separate sandboxes or (b) running
// child Node processes. We pick (a) using vm.runInNewContext — the simplest
// portable approach without extra deps.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── Shared in-process BroadcastChannel polyfill ──────────────────────────────
// All channels with the same name share a global subscriber set.
const BUSES = new Map();
function makeBroadcastChannel() {
  return class BroadcastChannel {
    constructor(name) {
      this.name = name;
      this._listeners = [];
      this._closed = false;
      if (!BUSES.has(name)) BUSES.set(name, new Set());
      BUSES.get(name).add(this);
    }
    addEventListener(_type, fn) { this._listeners.push(fn); }
    postMessage(data) {
      if (this._closed) return;
      const peers = BUSES.get(this.name);
      if (!peers) return;
      for (const peer of peers) {
        if (peer === this || peer._closed) continue;
        // Async delivery, like the real spec.
        setImmediate(() => {
          for (const l of peer._listeners) {
            try { l({ data }); } catch (_) {}
          }
        });
      }
    }
    close() {
      this._closed = true;
      const peers = BUSES.get(this.name);
      if (peers) peers.delete(this);
    }
  };
}

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "store", "sync-leader.js"),
  "utf8"
);

// Each "tab" gets its own sandbox global so module-level state is isolated.
function newTab(label) {
  const sandbox = {
    console: {
      log: (...a) => console.log(`[${label}]`, ...a),
      warn: (...a) => console.warn(`[${label}]`, ...a),
      error: (...a) => console.error(`[${label}]`, ...a),
    },
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    Promise, Date, Math, Object, JSON, Array, Error,
    BroadcastChannel: makeBroadcastChannel(),
    // crypto.randomUUID — Node 19+ has this, but we want determinism per tab
    // for tiebreak tests, so we let callers pass an override.
    crypto: {
      randomUUID: () => `${label}-${Math.random().toString(36).slice(2, 10)}`,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return sandbox;
}

// All tabs share the same BroadcastChannel global but each gets its own
// sandbox; replace the per-tab BroadcastChannel with a shared one so they
// can talk.
const SharedBC = makeBroadcastChannel();

function newSharedTab(label, tabIdOverride) {
  const sandbox = {
    console: {
      log: (...a) => console.log(`[${label}]`, ...a),
      warn: (...a) => console.warn(`[${label}]`, ...a),
      error: (...a) => console.error(`[${label}]`, ...a),
    },
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    Promise, Date, Math, Object, JSON, Array, Error,
    BroadcastChannel: SharedBC,
    crypto: {
      randomUUID: () => tabIdOverride || `${label}-${Math.random().toString(36).slice(2, 10)}`,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return sandbox;
}

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log("  ✓ " + name);
    passed++;
  } catch (err) {
    console.error("  ✗ " + name);
    console.error("    " + (err && err.stack ? err.stack : err));
    failed++;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Tests ────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\nSyncLeader: API surface");

  await test("module loads and exposes expected API", () => {
    const tab = newTab("solo");
    const SL = tab.SyncLeader;
    assert.ok(SL, "SyncLeader must be defined");
    assert.strictEqual(typeof SL.whenReady, "function");
    assert.strictEqual(typeof SL.broadcastPayload, "function");
    assert.strictEqual(typeof SL.onPayload, "function");
    assert.strictEqual(typeof SL.getRole, "function");
    assert.strictEqual(typeof SL.dispose, "function");
    SL.dispose();
  });

  console.log("\nSyncLeader: single-tab election");

  await test("single tab → role = leader (no peers respond)", async () => {
    BUSES.clear();
    const tab = newSharedTab("a", "aaa-tab");
    const ready = await tab.SyncLeader.whenReady();
    assert.strictEqual(ready.role, "leader");
    assert.strictEqual(tab.SyncLeader.getRole(), "leader");
    tab.SyncLeader.dispose();
  });

  console.log("\nSyncLeader: leader/follower election");

  await test("second tab joins → becomes follower; receives buffered payload", async () => {
    BUSES.clear();
    const A = newSharedTab("A", "aaa-tab");
    const readyA = await A.SyncLeader.whenReady();
    assert.strictEqual(readyA.role, "leader");

    // Leader broadcasts a payload before B joins.
    A.SyncLeader.broadcastPayload({ days: [{ d: 1 }], entries: [], userId: "u1", ts: 1 });

    const B = newSharedTab("B", "bbb-tab");
    let received = null;
    B.SyncLeader.onPayload((p) => { received = p; });
    const readyB = await B.SyncLeader.whenReady();
    assert.strictEqual(readyB.role, "follower");
    // payload re-broadcast is async (setImmediate after ack); give it a tick.
    await wait(50);
    assert.ok(received, "follower should receive payload");
    assert.deepStrictEqual(received.days, [{ d: 1 }]);

    A.SyncLeader.dispose();
    B.SyncLeader.dispose();
  });

  await test("payload omits carryover field even if caller passes one", async () => {
    BUSES.clear();
    const A = newSharedTab("A", "aaa-tab");
    await A.SyncLeader.whenReady();
    const B = newSharedTab("B", "bbb-tab");
    let received = null;
    B.SyncLeader.onPayload((p) => { received = p; });
    await B.SyncLeader.whenReady();

    A.SyncLeader.broadcastPayload({
      days: [], entries: [], userId: "u1", ts: 1,
      carryover: { b12: 999, vit_e: 999 }, // must be stripped
    });
    await wait(50);
    assert.ok(received, "follower received");
    assert.strictEqual(received.carryover, undefined,
      "carryover field must be stripped from broadcast payload");

    A.SyncLeader.dispose();
    B.SyncLeader.dispose();
  });

  console.log("\nSyncLeader: leader handoff");

  await test("leader pagehide-equivalent (leader-leaving) → follower re-elects to leader", async () => {
    BUSES.clear();
    const A = newSharedTab("A", "aaa-tab");
    await A.SyncLeader.whenReady();
    const B = newSharedTab("B", "bbb-tab");
    await B.SyncLeader.whenReady();
    assert.strictEqual(B.SyncLeader.getRole(), "follower");

    // Simulate leader A leaving by disposing — but dispose() doesn't
    // broadcast leader-leaving. Manually post the message via A's channel.
    // Easier: invoke pagehideHandler analogue by sending the message
    // through a fresh BroadcastChannel(...).
    const bc = new SharedBC("sync-leader");
    bc.postMessage({ type: "leader-leaving", leaderId: "aaa-tab" });
    A.SyncLeader.dispose();
    bc.close();

    // Wait for B to detect & re-elect (jitter + ELECTION_WAIT_MS).
    await wait(300);
    assert.strictEqual(B.SyncLeader.getRole(), "leader",
      "B should have re-elected to leader after A left");

    B.SyncLeader.dispose();
  });

  await test("missing BroadcastChannel → degrades to leader (single-tab fallback)", async () => {
    // Build a fresh sandbox with no BroadcastChannel.
    const sandbox = {
      console,
      setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
      Promise, Date, Math, Object, JSON, Array, Error,
      crypto: { randomUUID: () => "fallback-tab" },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(SOURCE, sandbox);
    const ready = await sandbox.SyncLeader.whenReady();
    assert.strictEqual(ready.role, "leader",
      "without BroadcastChannel, every tab must self-elect leader");
    sandbox.SyncLeader.dispose();
  });

  console.log("\nSyncLeader: tiebreak");

  await test("simultaneous claims → lower tabId wins, higher demotes", async () => {
    BUSES.clear();
    // Boot both tabs at the same time. Lower tabId is "aaa".
    const A = newSharedTab("A", "aaa-tab");
    const B = newSharedTab("B", "zzz-tab");
    const [readyA, readyB] = await Promise.all([
      A.SyncLeader.whenReady(),
      B.SyncLeader.whenReady(),
    ]);
    // Give heartbeats a moment to trigger the demotion path if both
    // self-elected.
    await wait(2200);

    const roles = [readyA.role, readyB.role, A.SyncLeader.getRole(), B.SyncLeader.getRole()];
    // After tiebreak, exactly one of them must end as leader.
    const leaders = [A.SyncLeader.getRole(), B.SyncLeader.getRole()].filter(r => r === "leader");
    assert.strictEqual(leaders.length, 1,
      "exactly one tab must end as leader (got " + JSON.stringify(roles) + ")");
    // The lower tabId ("aaa-tab") must be the leader.
    assert.strictEqual(A.SyncLeader.getRole(), "leader",
      "lower tabId must win tiebreak");

    A.SyncLeader.dispose();
    B.SyncLeader.dispose();
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
