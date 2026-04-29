// Multi-tab sync leader election — Phase 6 of the Supabase migration.
//
// Public API: window.SyncLeader.{ whenReady, broadcastPayload, onPayload,
//                                  getRole, dispose, _resetForTest, _setNowForTest }
//
// Phase 6 contract:
//   - Only ONE tab per origin should hit RemoteStore on boot. Followers
//     receive the hydration payload via BroadcastChannel("sync-leader") and
//     warm their L1 (in-memory React state) from it — zero extra reads.
//   - Carryover values never cross the wire. The leader broadcasts only the
//     raw { days, entries } it fetched; each tab keeps using
//     Modules.Carryover.computeCarryover() locally. This module enforces
//     that contract by simply not having a "carryover" field in the payload
//     schema — there is no way for a caller to leak one.
//
// Election protocol (claim-with-ack):
//   1. On init, each tab generates `tabId = crypto.randomUUID()` and sleeps
//      a random 0–50 ms (jitter) to stagger simultaneous boots.
//   2. Tab broadcasts { type: "claim", tabId }.
//   3. If a current leader exists, it replies with
//      { type: "ack-leader", leaderId } within ELECTION_WAIT_MS (150 ms).
//      The new tab becomes follower; whenReady() resolves once the leader's
//      next "payload" message arrives (or immediately if one is buffered).
//   4. If no ack arrives within ELECTION_WAIT_MS, the tab claims leadership
//      and resolves whenReady() with role="leader" so the caller can fetch.
//   5. Leader heartbeats every HEARTBEAT_MS (2000 ms). Followers track the
//      last heartbeat; if HEARTBEAT_TIMEOUT_MS (5000 ms) elapses without
//      one, they re-elect.
//   6. Tiebreak (rare race when two tabs claim simultaneously): when a
//      leader receives another claim or heartbeat from a different tabId,
//      the lexicographically lower tabId stays leader. Higher tabId demotes
//      to follower.
//
// Handoff:
//   - Leader fires { type: "leader-leaving", leaderId } from a `pagehide`
//     listener. Followers immediately re-elect with fresh jitter.
//
// Loaded as a plain <script> after src/store/write-behind.js. No deps on
// React, Identity, or RemoteStore — pure BroadcastChannel.
(function (global) {
  "use strict";

  var CHANNEL_NAME = "sync-leader";
  var ELECTION_WAIT_MS = 150;
  var HEARTBEAT_MS = 2000;
  var HEARTBEAT_TIMEOUT_MS = 5000;
  var JITTER_MAX_MS = 50;

  var role = "electing";          // "electing" | "leader" | "follower"
  var tabId = null;
  var leaderId = null;
  var channel = null;
  var heartbeatTimer = null;
  var heartbeatWatchdog = null;
  var lastHeartbeatAt = 0;
  var bufferedPayload = null;     // last payload seen, for late subscribers
  var payloadSubscribers = [];    // Set of cb fns
  var readyResolvers = [];        // pending whenReady() resolvers
  var disposed = false;
  var pagehideHandler = null;

  // Test seam — overridable now() for deterministic heartbeat tests.
  var nowFn = function () { return Date.now(); };

  function newTabId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "t-" + Math.random().toString(36).slice(2) + "-" + Date.now();
  }

  function send(msg) {
    if (!channel) return;
    try { channel.postMessage(msg); } catch (_) { /* channel closed */ }
  }

  function setRole(next) {
    role = next;
  }

  function resolveReady() {
    var snap = readyResolvers.slice();
    readyResolvers.length = 0;
    for (var i = 0; i < snap.length; i++) {
      try { snap[i]({ role: role }); } catch (_) {}
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(function () {
      send({ type: "heartbeat", leaderId: tabId });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function startHeartbeatWatchdog() {
    stopHeartbeatWatchdog();
    heartbeatWatchdog = setInterval(function () {
      if (role !== "follower") return;
      if (nowFn() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        // Leader is silent — re-elect.
        leaderId = null;
        beginElection();
      }
    }, 1000);
  }

  function stopHeartbeatWatchdog() {
    if (heartbeatWatchdog) { clearInterval(heartbeatWatchdog); heartbeatWatchdog = null; }
  }

  function becomeLeader() {
    setRole("leader");
    leaderId = tabId;
    stopHeartbeatWatchdog();
    startHeartbeat();
    resolveReady();
  }

  function becomeFollower(newLeaderId) {
    setRole("follower");
    leaderId = newLeaderId;
    lastHeartbeatAt = nowFn();
    stopHeartbeat();
    startHeartbeatWatchdog();
    // Resolve whenReady() on role determination — caller uses onPayload()
    // to consume data asynchronously. If a payload is already buffered,
    // flush it to subscribers (they may have subscribed *before* whenReady
    // resolved, expecting buffered delivery).
    if (bufferedPayload) {
      flushPayloadToSubscribers(bufferedPayload);
    }
    resolveReady();
  }

  function flushPayloadToSubscribers(payload) {
    var snap = payloadSubscribers.slice();
    for (var i = 0; i < snap.length; i++) {
      try { snap[i](payload); } catch (e) { /* subscriber threw — ignore */ }
    }
  }

  function beginElection() {
    setRole("electing");
    var jitter = Math.floor(Math.random() * (JITTER_MAX_MS + 1));
    setTimeout(function () {
      if (disposed) return;
      if (role !== "electing") return;
      send({ type: "claim", tabId: tabId });
      setTimeout(function () {
        if (disposed) return;
        if (role !== "electing") return;
        // No ack within window → claim leadership.
        becomeLeader();
      }, ELECTION_WAIT_MS);
    }, jitter);
  }

  function onMessage(ev) {
    var msg = ev && ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.tabId === tabId || msg.leaderId === tabId) return; // ignore self

    switch (msg.type) {
      case "claim":
        // Someone is trying to become leader. An established leader always
        // acks and stays — a fresh joiner must NOT unseat us. Tiebreak by
        // tabId only happens between two co-claimants discovered via the
        // heartbeat / ack-leader paths (initial-election race).
        if (role === "leader") {
          send({ type: "ack-leader", leaderId: tabId });
          // Re-broadcast last payload so the late joiner gets it without
          // waiting for the next leader-side hydration (which may never
          // happen if the leader has already finished fetching).
          if (bufferedPayload) {
            send({ type: "payload", from: tabId, payload: bufferedPayload });
          }
        }
        // electing/follower: ignore — leader (if any) will respond.
        break;

      case "ack-leader":
        if (role === "electing") {
          becomeFollower(msg.leaderId);
        } else if (role === "leader" && msg.leaderId !== tabId) {
          // Two leaders exist (rare race). Lower tabId wins.
          if (msg.leaderId < tabId) {
            stopHeartbeat();
            becomeFollower(msg.leaderId);
          }
        }
        break;

      case "heartbeat":
        if (role === "leader" && msg.leaderId !== tabId) {
          // Another leader is heartbeating. Tiebreak.
          if (msg.leaderId < tabId) {
            stopHeartbeat();
            becomeFollower(msg.leaderId);
          }
          break;
        }
        if (role === "follower" && msg.leaderId === leaderId) {
          lastHeartbeatAt = nowFn();
        } else if (role === "follower" && msg.leaderId !== leaderId) {
          // Different leader than we knew — accept it (they may have just
          // taken over). Update lastHeartbeatAt so we don't re-elect.
          leaderId = msg.leaderId;
          lastHeartbeatAt = nowFn();
        }
        break;

      case "payload":
        bufferedPayload = msg.payload;
        if (role === "follower" || role === "electing") {
          flushPayloadToSubscribers(msg.payload);
          if (role === "electing") {
            // Late ack-via-payload: treat the sender as leader.
            becomeFollower(msg.from || leaderId);
          } else {
            resolveReady(); // unblock any whenReady() waiters
          }
        }
        break;

      case "leader-leaving":
        if (msg.leaderId === leaderId || role !== "leader") {
          leaderId = null;
          stopHeartbeatWatchdog();
          beginElection();
        }
        break;

      default:
        break;
    }
  }

  function init() {
    if (disposed) return;
    if (channel) return; // already initialised
    if (typeof global.BroadcastChannel !== "function") {
      // Environment without BroadcastChannel (e.g. very old browsers).
      // Degrade to leader-everywhere — every tab fetches, same as Phase 4.
      tabId = newTabId();
      becomeLeader();
      return;
    }
    tabId = newTabId();
    channel = new global.BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", onMessage);

    pagehideHandler = function () {
      if (role === "leader") {
        send({ type: "leader-leaving", leaderId: tabId });
      }
    };
    if (typeof global.addEventListener === "function") {
      global.addEventListener("pagehide", pagehideHandler);
    }

    beginElection();
  }

  function whenReady() {
    if (disposed) return Promise.resolve({ role: "leader" });
    init();
    return new Promise(function (resolve) {
      if (role === "leader" || role === "follower") {
        resolve({ role: role });
        return;
      }
      readyResolvers.push(resolve);
    });
  }

  function broadcastPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    // Strip any caller-provided carryover field defensively — payloads must
    // not carry computed values across the wire.
    if ("carryover" in payload) {
      payload = Object.assign({}, payload);
      delete payload.carryover;
    }
    bufferedPayload = payload;
    send({ type: "payload", from: tabId, payload: payload });
  }

  function onPayload(cb) {
    if (typeof cb !== "function") return function () {};
    payloadSubscribers.push(cb);
    if (bufferedPayload) {
      try { cb(bufferedPayload); } catch (_) {}
    }
    return function unsubscribe() {
      var i = payloadSubscribers.indexOf(cb);
      if (i >= 0) payloadSubscribers.splice(i, 1);
    };
  }

  function getRole() { return role; }

  function dispose() {
    disposed = true;
    stopHeartbeat();
    stopHeartbeatWatchdog();
    if (channel) {
      try { channel.close(); } catch (_) {}
      channel = null;
    }
    if (pagehideHandler && typeof global.removeEventListener === "function") {
      global.removeEventListener("pagehide", pagehideHandler);
    }
    pagehideHandler = null;
    payloadSubscribers.length = 0;
    readyResolvers.length = 0;
    bufferedPayload = null;
    role = "electing";
    tabId = null;
    leaderId = null;
  }

  function _resetForTest() {
    dispose();
    disposed = false;
  }

  function _setNowForTest(fn) { nowFn = fn || function () { return Date.now(); }; }

  global.SyncLeader = {
    whenReady: whenReady,
    broadcastPayload: broadcastPayload,
    onPayload: onPayload,
    getRole: getRole,
    dispose: dispose,
    _resetForTest: _resetForTest,
    _setNowForTest: _setNowForTest,
    // exposed for tests only — do not use from app code:
    _CONSTANTS: {
      ELECTION_WAIT_MS: ELECTION_WAIT_MS,
      HEARTBEAT_MS: HEARTBEAT_MS,
      HEARTBEAT_TIMEOUT_MS: HEARTBEAT_TIMEOUT_MS,
      JITTER_MAX_MS: JITTER_MAX_MS,
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
