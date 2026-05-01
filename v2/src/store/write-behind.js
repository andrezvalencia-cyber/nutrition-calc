// Write-behind queue for Phase 5 Supabase sync.
//
// Public API: window.WriteBehind.{ enqueue, flush, getQueueDepth, isCircuitOpen }
//
// enqueue({ table, op, payload, rollback, immediate })
//   table:     'day_entries' | 'days'
//   op:        'upsert' | 'delete'
//   payload:   row object (must include user_id; day_entries need idempotency_key)
//   rollback:  optional fn called when all retries are exhausted (undo optimistic update)
//   immediate: true = skip 2 s debounce (use for handleLogDay, sign-out, pagehide)
//
// Backoff: min(500ms * 2^n + jitter(0..500ms), 30 s), max 6 tries per item.
// Circuit breaker: opens after 3 consecutive failures; closes on online + session ping.
// IndexedDB overflow (idb-keyval): queued items survive page reload when circuit is open.
//
// Ordering contract (since the supabase-js lazy-load change):
//   - flush() calls into Modules.Identity.getClient(), which returns null
//     until Modules.Identity.init() has resolved. Items already enqueued
//     when the client is null stay in the queue and flush on the next tick
//     once init() resolves.
//   - Callers MUST gate on auth.status === "signed_in" before enqueuing
//     (or await Modules.Identity.init() first). The existing isSyncEnabled
//     guard handles this in app.jsx; new callers must follow suit.
(function (global) {
  "use strict";

  var DEBOUNCE_MS       = 2000;
  var MAX_TRIES         = 6;
  var BASE_DELAY_MS     = 500;
  var MAX_DELAY_MS      = 30000;
  var CIRCUIT_THRESHOLD = 3;

  var queue            = [];
  var consecutiveFails = 0;
  var circuitOpen      = false;
  var flushTimer       = null;
  var _clientId        = null;

  // ── Client ID (stable UUID persisted in localStorage) ────────────
  function ensureClientId() {
    if (_clientId) return _clientId;
    try { _clientId = localStorage.getItem("wbq_client_id"); } catch (e) {}
    if (!_clientId) {
      _clientId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      try { localStorage.setItem("wbq_client_id", _clientId); } catch (e) {}
    }
    return _clientId;
  }

  function newQueueKey() {
    var uid = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    return ensureClientId() + ":" + uid;
  }

  // ── Supabase client ───────────────────────────────────────────────
  function getClient() {
    var I = global.Modules && global.Modules.Identity;
    return (I && I.getClient && I.getClient()) || null;
  }

  function ping() {
    var c = getClient();
    if (!c) return Promise.reject(new Error("no client"));
    return c.auth.getSession().then(function (r) {
      if (r && r.error) throw r.error;
      return !!(r && r.data && r.data.session);
    });
  }

  // ── Backoff ───────────────────────────────────────────────────────
  // Pure function — exported as _backoffDelay for unit tests.
  function backoffDelay(tries) {
    var jitter = Math.random() * BASE_DELAY_MS;
    return Math.min(BASE_DELAY_MS * Math.pow(2, tries) + jitter, MAX_DELAY_MS);
  }

  // ── IndexedDB overflow via idb-keyval ─────────────────────────────
  var _idbStore = null;
  function idbStore() {
    if (!_idbStore && global.idbKeyval && global.idbKeyval.createStore) {
      try { _idbStore = global.idbKeyval.createStore("vitality-v2-wbq", "write_queue"); }
      catch (e) {}
    }
    return _idbStore;
  }
  function idbSet(key, val) {
    var s = idbStore();
    if (!s) return;
    global.idbKeyval.set(key, val, s).catch(function () {});
  }
  function idbDel(key) {
    var s = idbStore();
    if (!s) return;
    global.idbKeyval.del(key, s).catch(function () {});
  }
  function idbValues() {
    var s = idbStore();
    if (!s) return Promise.resolve([]);
    return global.idbKeyval.values(s).catch(function () { return []; });
  }

  // ── Perform one Supabase write ────────────────────────────────────
  function performWrite(item) {
    var c = getClient();
    if (!c) return Promise.reject(new Error("no client"));

    if (item.table === "day_entries") {
      if (item.op === "upsert") {
        return c.from("day_entries")
          .upsert(item.payload, { onConflict: "idempotency_key" })
          .then(function (r) { if (r && r.error) throw r.error; });
      }
      if (item.op === "delete") {
        // Soft-delete: set deleted_at instead of physical removal (LWW-safe).
        return c.from("day_entries")
          .update({ deleted_at: new Date().toISOString() })
          .eq("idempotency_key", item.payload.idempotency_key)
          .eq("user_id", item.payload.user_id)
          .then(function (r) { if (r && r.error) throw r.error; });
      }
    }

    if (item.table === "days") {
      return c.from("days")
        .upsert(item.payload, { onConflict: "user_id,day_date" })
        .then(function (r) { if (r && r.error) throw r.error; });
    }

    return Promise.resolve();
  }

  // ── Flush loop ────────────────────────────────────────────────────
  function scheduleFlush(delayMs) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delayMs || 0);
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (circuitOpen || queue.length === 0) return;

    var now     = Date.now();
    var item    = null;
    var minNext = Infinity;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].nextRetry <= now) { item = queue[i]; break; }
      if (queue[i].nextRetry < minNext) minNext = queue[i].nextRetry;
    }
    if (!item) { scheduleFlush(minNext - now); return; }

    performWrite(item).then(function () {
      consecutiveFails = 0;
      queue = queue.filter(function (q) { return q.key !== item.key; });
      idbDel(item.key);
      if (queue.length > 0) scheduleFlush(0);
    }).catch(function () {
      consecutiveFails++;
      item.tries++;

      if (consecutiveFails >= CIRCUIT_THRESHOLD) {
        circuitOpen = true;
        console.warn("[wbq] circuit open — " + queue.length + " item(s) queued");
        return;
      }

      if (item.tries >= MAX_TRIES) {
        queue = queue.filter(function (q) { return q.key !== item.key; });
        idbDel(item.key);
        if (typeof item.rollback === "function") {
          try { item.rollback(); } catch (e) {}
        }
        try {
          global.dispatchEvent(new CustomEvent("wbq:failed", { detail: { key: item.key } }));
        } catch (e) {}
        if (queue.length > 0) scheduleFlush(0);
        return;
      }

      var delay = backoffDelay(item.tries);
      item.nextRetry = Date.now() + delay;
      idbSet(item.key, { key: item.key, table: item.table, op: item.op,
                         payload: item.payload, tries: item.tries, nextRetry: item.nextRetry });
      scheduleFlush(delay);
    });
  }

  // ── Enqueue ───────────────────────────────────────────────────────
  function enqueue(opts) {
    var item = {
      key:       newQueueKey(),
      table:     opts.table,
      op:        opts.op,
      payload:   opts.payload,
      tries:     0,
      nextRetry: 0,
      rollback:  opts.rollback || null,
      immediate: !!opts.immediate,
    };
    queue.push(item);
    // Persist to IDB so the item survives a page reload during a circuit-open state.
    idbSet(item.key, { key: item.key, table: item.table, op: item.op,
                       payload: item.payload, tries: 0, nextRetry: 0 });

    if (item.immediate) {
      if (!circuitOpen) flush();
    } else {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, DEBOUNCE_MS);
    }
  }

  // ── Circuit reconnect ─────────────────────────────────────────────
  function tryCloseCircuit() {
    if (!circuitOpen) return;
    ping().then(function (hasSession) {
      if (!hasSession) return;
      circuitOpen      = false;
      consecutiveFails = 0;
      console.info("[wbq] circuit closed");
      flush();
    }).catch(function () {});
  }

  if (global.addEventListener) {
    global.addEventListener("online",      tryCloseCircuit);
    global.addEventListener("pagehide",    function () { if (!circuitOpen) flush(); });
    global.addEventListener("beforeunload",function () { if (!circuitOpen) flush(); });
  }

  // ── Re-hydrate persisted queue on boot ───────────────────────────
  // Delayed 800 ms so Modules.Identity has time to initialise.
  setTimeout(function () {
    idbValues().then(function (items) {
      if (!items || !items.length) return;
      var now = Date.now();
      items.forEach(function (item) {
        if (!item || !item.key) return;
        if (queue.some(function (q) { return q.key === item.key; })) return;
        queue.push({ key: item.key, table: item.table, op: item.op,
                     payload: item.payload, tries: item.tries || 0,
                     nextRetry: item.nextRetry || now, rollback: null, immediate: false });
      });
      if (queue.length > 0) scheduleFlush(1000);
    });
  }, 800);

  // ── Public API ────────────────────────────────────────────────────
  global.WriteBehind = {
    enqueue:      enqueue,
    flush:        flush,
    getQueueDepth:  function () { return queue.length; },
    isCircuitOpen:  function () { return circuitOpen; },
    // Test-only helpers (prefixed _)
    _backoffDelay:  backoffDelay,
    _resetForTest:  function () {
      queue = []; consecutiveFails = 0; circuitOpen = false;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    },
    _openCircuit:   function () { circuitOpen = true; },
    _addFailures:   function (n) { consecutiveFails += n; },
    _tryCloseCircuit: tryCloseCircuit,
  };
})(typeof window !== "undefined" ? window : global);
