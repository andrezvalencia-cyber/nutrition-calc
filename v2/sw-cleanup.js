// SW Cleanup — runs on every V2 page load.
// Unregisters any legacy Service Workers and clears all caches.
// Satisfies `script-src 'self'` CSP (no inline script needed).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) { r.unregister(); });
  });
}
if ('caches' in window) {
  caches.keys().then(function (names) {
    names.forEach(function (n) { caches.delete(n); });
  });
}
