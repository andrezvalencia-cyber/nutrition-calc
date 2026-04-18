/* Minimal OTLP/JSON-shaped tracer — console exporter.
   No external deps, no CSP changes. Emits one JSON line per span
   via console.info("[otel]", json). Never accept secrets as attrs. */
(function () {
  "use strict";

  var FORBIDDEN_ATTR_KEYS = [
    "api_key", "apiKey", "x-api-key",
    "authorization", "Authorization",
    "prompt", "body", "input", "messages",
  ];

  function hex(bytes) {
    var a = new Uint8Array(bytes);
    (crypto && crypto.getRandomValues) ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    var s = "";
    for (var i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, "0");
    return s;
  }

  function nowNano() {
    // performance.timeOrigin + performance.now() in ns; fallback to Date.now
    if (typeof performance !== "undefined" && performance.timeOrigin) {
      return String(Math.round((performance.timeOrigin + performance.now()) * 1e6));
    }
    return String(Date.now() * 1e6);
  }

  // Value-level scrubs: API-key-shaped tokens + inline Authorization headers.
  var SECRET_PATTERNS = [
    /sk-(ant|live|test)-[A-Za-z0-9_\-]{10,}/gi,
    /bearer\s+[A-Za-z0-9_\-\.]{10,}/gi,
    /authorization\s*[:=]\s*[^\s,;]+/gi,
    /x-api-key\s*[:=]\s*[^\s,;]+/gi,
  ];

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
        return span;
      },
    };
  }

  window.__tracer = {
    traceId: traceId,
    startSpan: startSpan,
  };
})();
