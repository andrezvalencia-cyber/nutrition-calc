/* Vitality v2 — Scanner module (barcode / QR code).
 *
 * Browser-only self-attaching IIFE. Public surface:
 *   window.Modules.Scanner.isSupported()                    -> boolean
 *   window.Modules.Scanner.requestCamera()                  -> Promise<MediaStream>
 *   window.Modules.Scanner.loadLibrary()                    -> Promise<void>
 *   window.Modules.Scanner.start(elementId, { onDecode, onError }) -> Promise<void>
 *   window.Modules.Scanner.stop()                           -> Promise<void>
 *
 * CDN dependency: html5-qrcode 2.3.8 (pinned, SRI-verified).
 *   URL: https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js
 *   Integrity: sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+
 *
 * requestCamera() probes permission by acquiring then immediately releasing
 * a stream, so permission/hardware errors surface here without leaking a
 * held device. start() then runs the library's decode loop.
 *
 * Retry budget: up to 3 retries on transient getUserMedia errors
 * (NotReadableError, AbortError) with exponential backoff. Terminal errors
 * (NotAllowedError, SecurityError, NotFoundError, OverconstrainedError)
 * reject immediately.
 */
(function () {
  "use strict";

  var CDN_URL = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
  var CDN_INTEGRITY = "sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+";

  var TERMINAL_ERRORS = ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError"];
  var MAX_RETRIES = 3;

  var _scriptPromise = null;
  var _scanner = null;

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function isTerminal(err) {
    var name = (err && err.name) || "";
    for (var i = 0; i < TERMINAL_ERRORS.length; i++) {
      if (TERMINAL_ERRORS[i] === name) return true;
    }
    return false;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function requestCamera() {
    var attempt = 0;
    function tryOnce() {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(function (stream) {
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
          return stream;
        })
        .catch(function (err) {
          if (isTerminal(err) || attempt >= MAX_RETRIES) {
            try { console.warn("CAMERA_ACCESS_DENIED", err); } catch (_) {}
            throw err;
          }
          attempt++;
          return sleep(200 * Math.pow(2, attempt - 1)).then(tryOnce);
        });
    }
    return tryOnce();
  }

  function loadLibrary() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (_scriptPromise) return _scriptPromise;
    _scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = CDN_URL;
      s.crossOrigin = "anonymous";
      s.integrity = CDN_INTEGRITY;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        _scriptPromise = null;
        try { console.warn("[Scanner] html5-qrcode CDN load failed:", CDN_URL); } catch (_) {}
        reject(new Error("html5-qrcode CDN load failed"));
      };
      document.head.appendChild(s);
    });
    return _scriptPromise;
  }

  function start(elementId, opts) {
    opts = opts || {};
    return loadLibrary().then(function () {
      _scanner = new window.Html5Qrcode(elementId);
      return _scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        function onDecode(decodedText) {
          if (opts.onDecode) opts.onDecode(decodedText);
        },
        function onError() {}
      );
    });
  }

  function stop() {
    if (!_scanner) return Promise.resolve();
    var s = _scanner;
    _scanner = null;
    return s.stop().catch(function () {}).then(function () {
      try { s.clear(); } catch (_) {}
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.Scanner = {
    isSupported: isSupported,
    requestCamera: requestCamera,
    loadLibrary: loadLibrary,
    start: start,
    stop: stop,
  };
})();
