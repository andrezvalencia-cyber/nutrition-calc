// Unit test for v2/sw.js activate-handler cache eviction.
// Loads sw.js into a sandboxed VM with mocked self/caches, fires the
// activate handler with a seeded set of stale caches, and verifies that
// only the current-build caches survive.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const swSource = fs.readFileSync(path.resolve(__dirname, "../sw.js"), "utf8");

function runActivateHandler({ seededCacheNames }) {
  const cacheNames = new Set(seededCacheNames);
  const deleted = [];

  const cachesMock = {
    open: async () => ({ addAll: async () => {}, add: async () => {}, match: async () => undefined, put: async () => {} }),
    keys: async () => Array.from(cacheNames),
    delete: async (name) => {
      if (cacheNames.delete(name)) {
        deleted.push(name);
        return true;
      }
      return false;
    },
    match: async () => undefined,
  };

  const listeners = {};
  const selfMock = {
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: "http://localhost:8765" },
  };

  const sandbox = {
    self: selfMock,
    caches: cachesMock,
    fetch: async () => new Response(""),
    Response: class { constructor() {} },
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    Set,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);

  const event = {
    waitUntil: (p) => { event._promise = p; },
  };
  listeners.activate(event);
  return { promise: event._promise, deleted, remaining: () => Array.from(cacheNames) };
}

(async () => {
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  test("activate deletes stale shell cache and legacy nutri-calc-v1", async () => {
    // The sw.js placeholder is __BUILD_HASH__ in committed source, so the
    // current cache names are vitality-v2-shell-__BUILD_HASH__ and
    // vitality-v2-runtime-__BUILD_HASH__.
    const seeded = [
      "vitality-v2-shell-__BUILD_HASH__",
      "vitality-v2-runtime-__BUILD_HASH__",
      "vitality-v2-shell-OLDHASH00",
      "vitality-v2-runtime-OLDHASH00",
      "nutri-calc-v1",
      "some-other-app-cache",
    ];
    const { promise, deleted, remaining } = runActivateHandler({ seededCacheNames: seeded });
    await promise;

    const left = remaining();
    if (!left.includes("vitality-v2-shell-__BUILD_HASH__")) {
      throw new Error("current shell cache should survive: " + JSON.stringify(left));
    }
    if (!left.includes("vitality-v2-runtime-__BUILD_HASH__")) {
      throw new Error("current runtime cache should survive: " + JSON.stringify(left));
    }
    for (const stale of ["vitality-v2-shell-OLDHASH00", "vitality-v2-runtime-OLDHASH00", "nutri-calc-v1", "some-other-app-cache"]) {
      if (left.includes(stale)) {
        throw new Error("stale cache should have been deleted: " + stale);
      }
      if (!deleted.includes(stale)) {
        throw new Error("stale cache should have been in deleted list: " + stale);
      }
    }
  });

  test("activate is a no-op when only current-build caches exist", async () => {
    const seeded = ["vitality-v2-shell-__BUILD_HASH__", "vitality-v2-runtime-__BUILD_HASH__"];
    const { promise, deleted } = runActivateHandler({ seededCacheNames: seeded });
    await promise;
    if (deleted.length !== 0) {
      throw new Error("expected zero deletions, got: " + JSON.stringify(deleted));
    }
  });

  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log("  ✓ " + t.name);
      pass += 1;
    } catch (e) {
      console.error("  ✗ " + t.name + "\n    " + e.message);
      fail += 1;
    }
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail > 0) process.exit(1);
})();
