const { test, expect } = require('@playwright/test');

const EXPECTED_DECODE = 'SCAN_TEST_12345';

// ── (A) Decode → Quick Entry ─────────────────────────────────────────────────

test('barcode scan decodes QR and populates Quick Entry', async ({ page }) => {
  test.setTimeout(30000);

  // Deterministic decode seam: stub Modules.Scanner.start to fire onDecode
  // with a known value immediately, bypassing real ZXing decode timing.
  // The real html5-qrcode decode from a faked captureStream is unreliable
  // in headless Chromium, so this tests the full UI integration path
  // (button → modal → Scanner.start → onDecode → setQuickText) without
  // coupling to ZXing frame-timing.
  await page.addInitScript(`{
    const DECODE_VALUE = '${EXPECTED_DECODE}';
    // Fake getUserMedia so isSupported() and requestCamera() pass
    navigator.mediaDevices.getUserMedia = async function() {
      const canvas = document.createElement('canvas');
      canvas.width = 300; canvas.height = 300;
      const stream = canvas.captureStream(1);
      return stream;
    };
    // After scanner.js loads, override start() to fire onDecode deterministically
    const origDefine = Object.defineProperty;
    let scannerPatched = false;
    const patchScanner = () => {
      if (scannerPatched) return;
      if (!window.Modules || !window.Modules.Scanner) return;
      scannerPatched = true;
      const origStart = window.Modules.Scanner.start;
      window.Modules.Scanner.start = function(elementId, opts) {
        setTimeout(() => { if (opts && opts.onDecode) opts.onDecode(DECODE_VALUE); }, 100);
        return Promise.resolve();
      };
    };
    // Poll for Scanner availability (defer scripts load async)
    const iv = setInterval(() => {
      patchScanner();
      if (scannerPatched) clearInterval(iv);
    }, 50);
  }`);

  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 10000 });

  const scanBtn = page.locator('[data-testid="scan-camera"]');
  await expect(scanBtn).toBeVisible({ timeout: 5000 });
  await scanBtn.click();

  // Wait for the deterministic decode to populate Quick Entry
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector('input[placeholder="Describe what you ate..."]');
      return input && input.value === expected;
    },
    EXPECTED_DECODE,
    { timeout: 10000 }
  );

  const val = await page.inputValue('input[placeholder="Describe what you ate..."]');
  expect(val).toBe(EXPECTED_DECODE);
});

// ── (B) Permission gate ──────────────────────────────────────────────────────

test('barcode scan shows denied fallback when camera is blocked', async ({ page }) => {
  const warnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('CAMERA_ACCESS_DENIED')) {
      warnings.push(msg.text());
    }
  });

  // getUserMedia rejects with NotAllowedError
  await page.addInitScript(`{
    navigator.mediaDevices.getUserMedia = async function() {
      const err = new DOMException('Permission denied', 'NotAllowedError');
      throw err;
    };
  }`);

  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 10000 });

  const scanBtn = page.locator('[data-testid="scan-camera"]');
  await expect(scanBtn).toBeVisible({ timeout: 5000 });
  await scanBtn.click();

  // Denied fallback should render
  await expect(page.locator('[data-testid="scanner-denied"]')).toBeVisible({ timeout: 5000 });

  // React mount did not crash
  await expect(page.locator('#root')).not.toBeEmpty();

  // Console warning was fired
  expect(warnings.length).toBeGreaterThanOrEqual(1);
});
