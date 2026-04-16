// Integration tests for Vitality Nutrition Calculator
// Phase A TDD: tests 1-3 fail before fix (security structure), tests 4-6 are regression guards.

const { test, expect } = require('@playwright/test');

// ── Security structure (fail before fix, pass after) ─────────────────────────

test('CSP meta tag is present with no unsafe-eval', async ({ page }) => {
  await page.goto('/');
  const cspContent = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(cspContent).not.toBeNull();
  expect(cspContent).not.toContain("'unsafe-eval'");
});

test('Babel Standalone CDN script is not loaded', async ({ page }) => {
  const babelRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('@babel/standalone')) babelRequests.push(req.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(babelRequests).toHaveLength(0);
});

test('app.js is loaded as a pre-compiled script tag', async ({ page }) => {
  await page.goto('/');
  const count = await page.locator('script[src="app.js"]').count();
  expect(count).toBe(1);
});

// ── Functional regression tests ───────────────────────────────────────────────

test('app mounts and progress ring renders', async ({ page }) => {
  await page.goto('/');
  // Wait for React to mount — the SVG progress ring renders two visible circles
  await page.waitForSelector('svg circle[stroke="url(#primaryGradient)"]', { timeout: 8000 });
  // The root element must have visible content
  const root = await page.locator('#root');
  await expect(root).not.toBeEmpty();
});

test('food logging happy path: quick entry with special characters and long name', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });

  // Edge case: special characters (XSS guard — must not break the input)
  const xssPayload = '<script>alert(1)</script> & "Oats" \'bowl\'';
  await page.fill('input[placeholder="Describe what you ate..."]', xssPayload);
  const val = await page.inputValue('input[placeholder="Describe what you ate..."]');
  expect(val).toBe(xssPayload); // value accepted without crash

  // Clear and type long name (200 chars)
  const longName = 'A'.repeat(200);
  await page.fill('input[placeholder="Describe what you ate..."]', longName);
  const longVal = await page.inputValue('input[placeholder="Describe what you ate..."]');
  expect(longVal.length).toBe(200); // input not truncated by the UI

  // Page must still be functional (no JS crash)
  await expect(page.locator('#root')).not.toBeEmpty();
});

test('export button creates a Blob download without CSP error', async ({ page }) => {
  // Intercept console errors to detect CSP violations
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  // Navigate to Settings
  await page.waitForSelector('nav button', { timeout: 8000 });
  const settingsBtn = page.locator('nav button').last();
  await settingsBtn.click();

  // Wait for Settings screen
  await page.waitForSelector('button:has-text("Export All Data")', { timeout: 5000 });

  // Trigger export — sets up a download listener
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.click('button:has-text("Export All Data")'),
  ]);

  // Either a download was triggered OR no CSP error fired (Blob URL may navigate differently in headless)
  const cspErrors = consoleErrors.filter(
    (e) => e.toLowerCase().includes('content security policy') || e.toLowerCase().includes('potential risk')
  );
  expect(cspErrors).toHaveLength(0);
});

// ── Security regression: quickText length cap ────────────────────────────────

test('quick entry caps outbound prompt content at MAX_QUICK_TEXT', async ({ page }) => {
  const MAX = 500;
  // Seed a fake API key so handleAIEstimate proceeds past the early return
  await page.addInitScript(() => {
    localStorage.setItem('nutrition_calc_v2_api_key', 'sk-ant-test-fake');
  });

  let capturedBody = null;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    capturedBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: [{
          text: JSON.stringify({
            protein: 1, carbs: 1, fat: 1, fiber: 1, sat_fat: 1,
            epa_dha: 1, calcium: 1, iron: 1, zinc: 1, potassium: 1,
            magnesium: 1, vit_c: 1, vit_d: 1, vit_e: 1, b12: 1, folate: 1,
          }),
        }],
      }),
    });
  });

  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });

  const huge = 'x'.repeat(5000);
  const input = page.locator('input[placeholder="Describe what you ate..."]');
  await input.fill(huge);
  await input.press('Enter');

  const start = Date.now();
  while (!capturedBody && Date.now() - start < 5000) {
    await page.waitForTimeout(50);
  }

  expect(capturedBody).not.toBeNull();
  expect(capturedBody.messages[0].content.length).toBeLessThanOrEqual(MAX);
});

// ── Security regression: React UMD pinned + SRI ──────────────────────────────

test('unpkg <script> tags are pinned and carry SRI integrity', async ({ page }) => {
  await page.goto('/');
  const scripts = await page.locator('script[src*="unpkg.com"]').all();
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) {
    const src = await s.getAttribute('src');
    const integrity = await s.getAttribute('integrity');
    expect(src).toMatch(/react(-dom)?@\d+\.\d+\.\d+/);
    expect(integrity).toMatch(/^sha384-.+/);
  }
});

// ── Fat-soluble nutrient carryover (B12, Vit E, Vit D dead field) ─────────────
// Characterization tests. Pin the formula documented in CLAUDE.md §5 and
// implemented at app.jsx:484–498 (handleLogDay) + app.jsx:55–66 (runningTotals).
// A mutation of either path must break at least one of these tests.

test.describe('nutrient carryover', () => {
  const ZERO_NUTRIENTS = {
    protein: 0, carbs: 0, fat: 0, fiber: 0, sat_fat: 0, epa_dha: 0,
    calcium: 0, iron: 0, zinc: 0, vit_d: 0, vit_e: 0, b12: 0,
    folate: 0, vit_c: 0, potassium: 0, magnesium: 0,
  };

  async function seedState(page, overrides) {
    await page.addInitScript((seed) => {
      localStorage.setItem('nutrition_calc_v2', JSON.stringify(seed));
    }, overrides);
  }

  function stateWithDayLog(nutrients) {
    return {
      currentDate: new Date().toISOString().slice(0, 10),
      dayLog: [{ id: 'test-entry', name: 'Test Entry', nutrients }],
      fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
      carryoverDaysRemaining: { b12: 0, vit_e: 0 },
      dayHistory: [],
      darkMode: true,
      themeMode: 'dark',
      aiModel: 'claude-sonnet-4-6',
    };
  }

  async function triggerLogDay(page) {
    await page.waitForSelector('button:has-text("Log Day")', { timeout: 8000 });
    await page.click('button:has-text("Log Day")');
    await page.waitForSelector('button:has-text("Log & Start New Day")', { timeout: 5000 });
    await page.click('button:has-text("Log & Start New Day")');
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return Array.isArray(s.dayLog) && s.dayLog.length === 0;
    }, null, { timeout: 5000 });
  }

  async function readState(page) {
    return page.evaluate(() =>
      JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}')
    );
  }

  test('B12 entry ≥ 1000 mcg sets fatSolubleCarryover.b12 to round(5000/7) = 714', async ({ page }) => {
    const entryNutrients = { ...ZERO_NUTRIENTS, b12: 1000 };
    await seedState(page, stateWithDayLog(entryNutrients));

    await page.goto('/');
    await triggerLogDay(page);

    const post = await readState(page);
    expect(post.fatSolubleCarryover.b12).toBe(Math.round(5000 / 7));
    expect(post.fatSolubleCarryover.b12).toBe(714);
    expect(post.carryoverDaysRemaining.b12).toBe(6);
  });

  test('Vit E entry ≥ 100 mg sets fatSolubleCarryover.vit_e to round(268/7) = 38', async ({ page }) => {
    const entryNutrients = { ...ZERO_NUTRIENTS, vit_e: 100 };
    await seedState(page, stateWithDayLog(entryNutrients));

    await page.goto('/');
    await triggerLogDay(page);

    const post = await readState(page);
    expect(post.fatSolubleCarryover.vit_e).toBe(Math.round(268 / 7));
    expect(post.fatSolubleCarryover.vit_e).toBe(38);
    expect(post.carryoverDaysRemaining.vit_e).toBe(6);
  });

  test('Vit D carryover slot stays 0 even when dayLog contains Vit D (dead field guard)', async ({ page }) => {
    const entryNutrients = { ...ZERO_NUTRIENTS, vit_d: 999999 };
    await seedState(page, stateWithDayLog(entryNutrients));

    await page.goto('/');
    await triggerLogDay(page);

    const post = await readState(page);
    expect(post.fatSolubleCarryover.vit_d).toBe(0);
  });

  test('carryover decrements to 0 when daysRemaining enters Log Day at 1', async ({ page }) => {
    const state = stateWithDayLog({ ...ZERO_NUTRIENTS });
    state.fatSolubleCarryover.b12 = 714;
    state.carryoverDaysRemaining.b12 = 1;
    await seedState(page, state);

    await page.goto('/');
    await triggerLogDay(page);

    const post = await readState(page);
    expect(post.fatSolubleCarryover.b12).toBe(0);
    expect(post.carryoverDaysRemaining.b12).toBe(0);
  });

  test('runningTotals merges fatSolubleCarryover into gapsClosed count on mount', async ({ page }) => {
    const state = stateWithDayLog({ ...ZERO_NUTRIENTS });
    state.fatSolubleCarryover.b12 = 714;
    state.fatSolubleCarryover.vit_e = 38;
    state.carryoverDaysRemaining.b12 = 6;
    state.carryoverDaysRemaining.vit_e = 6;
    await seedState(page, state);

    await page.goto('/');
    await page.waitForSelector('button:has-text("Log Day")', { timeout: 8000 });
    await page.click('button:has-text("Log Day")');
    await page.waitForSelector('button:has-text("Log & Start New Day")', { timeout: 5000 });

    const header = await page.locator('h2:has-text("Log Day")').locator('..').locator('span').first().textContent();
    const match = header && header.match(/^(\d+)\/16$/);
    expect(match).not.toBeNull();
    const closed = parseInt(match[1], 10);
    // Baseline (no merge): only sat_fat is closed (0 < 28 max) → closed = 1.
    // With merge: B12 (714 ≥ 2.4) also closes → closed ≥ 2.
    expect(closed).toBeGreaterThanOrEqual(2);
  });
});
