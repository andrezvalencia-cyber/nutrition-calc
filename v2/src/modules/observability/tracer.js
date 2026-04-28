/* Vitality v2 — OTLP/JSON-shaped tracer.
 *
 * Two exporters:
 *   1. console: one JSON line per span via console.info("[otel]", json).
 *   2. beacon (optional, default OFF): batches finished spans and posts them
 *      to a Supabase Edge Function via navigator.sendBeacon on
 *      visibilitychange:hidden / pagehide / 60 s idle.
 *
 * Configure at runtime by setting:
 *   window.__observabilityConfig = { enabled: true, endpoint: "...", token: "..." }
 *   window.__tracer.refreshConfig?.();
 *
 * Until enabled is true the beacon path is fully inert: no network egress,
 * no buffer growth. The console exporter always runs.
 *
 * Span attributes are scrubbed for secrets at every entry point — never
 * accept api keys, prompts, or raw bodies as attrs (defense-in-depth on
 * top of CLAUDE.md §8).
 */
(function () {
  "use strict";

  var FORBIDDEN_ATTR_KEYS = [
    "api_key", "apiKey", "x-api-key",
    "authorization", "Authorization",
    "prompt", "body", "input", "messages",
  ];

  var SECRET_PATTERNS = [
    /sk-(ant|live|test)-[A-Za-z0-9_\-]{10,}/gi,
    /bearer\s+[A-Za-z0-9_\-\.]{10,}/gi,
    /authorization\s*[:=]\s*[^\s,;]+/gi,
    /x-api-key\s*[:=]\s*[^\s,;]+/gi,
  ];

  var BUFFER_MAX = 200;          // hard cap so a stuck flusher can't OOM
  var IDLE_FLUSH_MS = 60 * 1000; // periodic flush cadence

  function hex(bytes) {
    var a = new Uint8Array(bytes);
    (typeof crypto !== "undefined" && crypto.getRandomValues)
      ? crypto.getRandomValues(a)
      : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    var s = "";
    for (var i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, "0");
    return s;
  }

  function nowNano() {
    if (typeof performance !== "undefined" && performance.timeOrigin) {
      return String(Math.round((performance.timeOrigin + performance.now()) * 1e6));
    }
    return String(Date.now() * 1e6);
  }

  function scrubString(s) {
    var out = s;
    for (var i = 0; i < SECRET_PATTERNS.length; i++) {
      out = out.replace(SECRET_PATTERNS[i], "[REDACTED]");
    }
    return out;
  }

  function sanitizeAttrs(attrs) {
    var out = {};
    if (!attrs) return out;
    try {
      Object.keys(attrs).forEach(function (k) {
        var lk = k.toLowerCase();
        for (var i = 0; i < FORBIDDEN_ATTR_KEYS.length; i++) {
          if (lk === FORBIDDEN_ATTR_KEYS[i].toLowerCase()) return;
        }
        var v;
        try { v = attrs[k]; } catch (_) { return; }
        if (v === null || v === undefined) return;
        var t = typeof v;
        if (t === "string") { out[k] = scrubString(v); return; }
        if (t === "number" || t === "boolean") { out[k] = v; return; }
      });
    } catch (_) { /* return what we have */ }
    return out;
  }

  var traceId = hex(16);
  var buffer = [];
  var idleTimer = null;

  function getConfig() {
    var c = (typeof window !== "undefined" && window.__observabilityConfig) || {};
    return {
      enabled: !!c.enabled,
      endpoint: typeof c.endpoint === "string" ? c.endpoint : "",
      token: typeof c.token === "string" ? c.token : "",
    };
  }

  function bufferSpan(span) {
    var cfg = getConfig();
    if (!cfg.enabled) return;
    if (buffer.length >= BUFFER_MAX) buffer.shift();
    buffer.push(span);
  }

  function flushBeacon() {
    if (buffer.length === 0) return false;
    var cfg = getConfig();
    if (!cfg.enabled || !cfg.endpoint) return false;
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      return false;
    }
    var batch = buffer.splice(0, buffer.length);
    var payload = JSON.stringify({ spans: batch, token: cfg.token || undefined });
    var blob;
    try {
      blob = new Blob([payload], { type: "application/json" });
    } catch (_) {
      // Re-queue at the head and bail
      buffer = batch.concat(buffer);
      return false;
    }
    var ok = false;
    try {
      ok = navigator.sendBeacon(cfg.endpoint, blob);
    } catch (_) { ok = false; }
    if (!ok) {
      // Re-queue so the next flush can retry; keep within the cap.
      buffer = batch.concat(buffer).slice(-BUFFER_MAX);
    }
    return ok;
  }

  function startSpan(name, attrs) {
    var spanId = hex(8);
    var startNs = nowNano();
    var startMs = (typeof performance !== "undefined") ? performance.now() : Date.now();
    var initAttrs = sanitizeAttrs(attrs);
    return {
      traceId: traceId,
      spanId: spanId,
      end: function (status, extraAttrs) {
        var endNs = nowNano();
        var endMs = (typeof performance !== "undefined") ? performance.now() : Date.now();
        var merged = Object.assign({}, initAttrs, sanitizeAttrs(extraAttrs || {}));
        merged.duration_ms = Math.round(endMs - startMs);
        var span = {
          name: name,
          traceId: traceId,
          spanId: spanId,
          startTimeUnixNano: startNs,
          endTimeUnixNano: endNs,
          attributes: merged,
          status: { code: status === "error" ? "ERROR" : "OK" },
        };
        try { console.info("[otel]", JSON.stringify(span)); } catch (_) { /* noop */ }
        bufferSpan(span);
        return span;
      },
    };
  }

  function onVisibilityChange() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flushBeacon();
    }
  }
  function onPageHide() { flushBeacon(); }

  function startIdleTimer() {
    if (idleTimer || typeof window === "undefined") return;
    idleTimer = window.setInterval(flushBeacon, IDLE_FLUSH_MS);
  }

  if (typeof window !== "undefined") {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    window.addEventListener("pagehide", onPageHide);
    startIdleTimer();
  }

  window.__tracer = {
    traceId: traceId,
    startSpan: startSpan,
    flushBeacon: flushBeacon,
    _bufferSize: function () { return buffer.length; },
  };
})();
