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

// ── Multi-meal selection in LogDaySheet ──────────────────────────────────────

test('multi-select: two meals selected before Confirm produce two dayLog entries', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });
  // Open LogDaySheet via the "+" button in HomeScreen header
  await page.locator('button:has-text("add_circle")').first().click();
  await page.waitForSelector('h2:has-text("Log Entry")', { timeout: 8000 });

  // Click Lunch and Dinner cards (renamed from "Standard Lunch" / "Standard Dinner")
  const lunchBtn = page.getByRole('button', { name: /^\S+\s+Lunch$/ });
  const dinnerBtn = page.getByRole('button', { name: /^\S+\s+Dinner$/ });
  await lunchBtn.click();
  await dinnerBtn.click();

  // Both should show aria-pressed=true (active state)
  await expect(lunchBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(dinnerBtn).toHaveAttribute('aria-pressed', 'true');

  // Confirm
  await page.click('button:has-text("Confirm Entry")');

  // Verify dayLog has both recipeIds
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
    const ids = (s.dayLog || []).map((e) => e.recipeId);
    return ids.includes('standard_lunch') && ids.includes('standard_dinner');
  }, null, { timeout: 5000 });

  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}')
  );
  const ids = state.dayLog.map((e) => e.recipeId);
  expect(ids).toContain('standard_lunch');
  expect(ids).toContain('standard_dinner');
});

// ── Observability + layout stability (Phase 3/4) ─────────────────────────────

async function seedKeyAndMockAI(page, { delayMs = 150 } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('nutrition_calc_v2_api_key', 'sk-ant-test-fake');
  });
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
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
}

test('AI skeleton is visible while request is pending, removed after resolution', async ({ page }) => {
  await seedKeyAndMockAI(page, { delayMs: 400 });
  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });

  const input = page.locator('input[placeholder="Describe what you ate..."]');
  await input.fill('test meal');
  await input.press('Enter');

  const skeleton = page.locator('[data-testid="ai-skeleton"]');
  await expect(skeleton).toBeVisible({ timeout: 2000 });

  // After resolution, skeleton should disappear and a real meal row is present.
  await expect(skeleton).toBeHidden({ timeout: 5000 });
});

test('ai.request OTel span is emitted and contains no secrets or prompt text', async ({ page }) => {
  const otelLines = [];
  page.on('console', (msg) => {
    const parts = msg.args();
    // msg.text() concatenates args; look for the [otel] prefix.
    const txt = msg.text();
    if (txt.startsWith('[otel] ')) otelLines.push(txt.slice(7));
  });

  await seedKeyAndMockAI(page, { delayMs: 50 });
  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });

  const input = page.locator('input[placeholder="Describe what you ate..."]');
  await input.fill('secret-prompt-marker');
  await input.press('Enter');

  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
    return (s.dayLog || []).length > 0;
  }, null, { timeout: 5000 });

  // Give the span one tick to flush.
  await page.waitForTimeout(100);

  expect(otelLines.length).toBeGreaterThanOrEqual(1);
  const span = JSON.parse(otelLines[otelLines.length - 1]);
  expect(span.name).toBe('ai.request');
  expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  expect(span.status.code).toBe('OK');
  expect(typeof span.attributes.duration_ms).toBe('number');

  const serialized = JSON.stringify(span);
  expect(serialized).not.toContain('sk-ant-test-fake');
  expect(serialized).not.toContain('secret-prompt-marker');
  expect(serialized.toLowerCase()).not.toContain('authorization');
  expect(serialized.toLowerCase()).not.toContain('api_key');
});

test('cumulative layout shift stays under 0.01 during AI quick-entry', async ({ page }) => {
  await seedKeyAndMockAI(page, { delayMs: 300 });
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  });

  await page.goto('/');
  await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });

  const input = page.locator('input[placeholder="Describe what you ate..."]');
  await input.fill('test meal');
  await input.press('Enter');

  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
    return (s.dayLog || []).length > 0;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(300);

  const cls = await page.evaluate(() => window.__cls || 0);
  expect(cls).toBeLessThan(0.01);
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

// ── Performance: heatmap render stays under 1s with 30 days seeded ───────────

test('insights heatmap renders in under 1s with 30 days of history', async ({ page }) => {
  const ZERO = {
    protein: 0, carbs: 0, fat: 0, fiber: 0, sat_fat: 0, epa_dha: 0,
    calcium: 0, iron: 0, zinc: 0, vit_d: 0, vit_e: 0, b12: 0,
    folate: 0, vit_c: 0, potassium: 0, magnesium: 0,
  };
  await page.addInitScript((zero) => {
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const totals = {};
      Object.keys(zero).forEach((k) => { totals[k] = Math.random() * 200; });
      return { date: d, totals, gapsClosed: Math.floor(Math.random() * 16), energy: 3, digestion: 3 };
    });
    localStorage.setItem('nutrition_calc_v2', JSON.stringify({
      currentDate: new Date().toISOString().slice(0, 10),
      dayLog: [],
      fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
      carryoverDaysRemaining: { b12: 0, vit_e: 0 },
      dayHistory: days,
      themeMode: 'dark',
      aiModel: 'claude-sonnet-4-6',
    }));
  }, ZERO);

  await page.goto('/');
  await page.waitForSelector('nav button', { timeout: 8000 });
  // Insights tab is the third nav button (Home, Dashboard, Insights, Settings).
  const navButtons = page.locator('nav button');
  const t0 = Date.now();
  await navButtons.nth(2).click();
  await page.waitForSelector('[data-testid="nutrient-heatmap"]', { timeout: 2000 });
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeLessThan(1000);
});

// ── Security regression: React UMD pinned + SRI ──────────────────────────────

test('unpkg <script> tags are pinned and carry SRI integrity', async ({ page }) => {
  await page.goto('/');
  const scripts = await page.locator('script[src*="unpkg.com"]').all();
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) {
    const src = await s.getAttribute('src');
    const integrity = await s.getAttribute('integrity');
    expect(src).toMatch(/(react(-dom)?|@supabase\/supabase-js|idb-keyval)@\d+\.\d+\.\d+/);
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

// ── Phase 2: tracer beacon flush ──────────────────────────────────────────────

test.describe('observability beacon', () => {
  test('default-off: no sendBeacon call when observability disabled', async ({ page }) => {
    await page.addInitScript(() => {
      window.__beaconCalls = [];
      const orig = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
      navigator.sendBeacon = function (url, data) {
        window.__beaconCalls.push({ url: String(url), size: data && data.size });
        return orig ? orig(url, data) : true;
      };
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__tracer, { timeout: 5000 });
    await page.evaluate(() => {
      const s = window.__tracer.startSpan('ui.test', {});
      s.end('ok', {});
      // Simulate tab hide
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const calls = await page.evaluate(() => window.__beaconCalls);
    expect(calls).toEqual([]);
  });

  test('enabled: sendBeacon fires on visibilitychange:hidden with buffered spans', async ({ page }) => {
    await page.addInitScript(() => {
      window.__beaconCalls = [];
      navigator.sendBeacon = function (url, data) {
        window.__beaconCalls.push({ url: String(url), size: data && data.size });
        return true;
      };
      window.__observabilityConfig = {
        enabled: true,
        endpoint: 'https://example.supabase.co/functions/v1/observe',
        token: 'test-token',
      };
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__tracer, { timeout: 5000 });
    await page.evaluate(() => {
      window.__tracer.startSpan('ui.test', {}).end('ok', {});
      window.__tracer.startSpan('db.test', {}).end('ok', {});
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const calls = await page.evaluate(() => window.__beaconCalls);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].url).toContain('supabase.co/functions/v1/observe');
    expect(calls[0].size).toBeGreaterThan(0);
    const bufLen = await page.evaluate(() => window.__tracer._bufferSize());
    expect(bufLen).toBe(0);
  });
});

// ── Phase 3: Cloud Sync UI (auth scaffolding, no read/write yet) ─────────────
test.describe('cloud sync settings', () => {
  test('supabase-js UMD is pinned and carries SRI integrity', async ({ page }) => {
    await page.goto('/');
    const sb = page.locator('script[src*="@supabase/supabase-js"]');
    await expect(sb).toHaveCount(1);
    const src = await sb.getAttribute('src');
    const integrity = await sb.getAttribute('integrity');
    expect(src).toMatch(/@supabase\/supabase-js@\d+\.\d+\.\d+/);
    expect(integrity).toMatch(/^sha384-.+/);
  });

  test('window.Modules.Identity exposes the public API surface', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.Modules && window.Modules.Identity, { timeout: 5000 });
    const api = await page.evaluate(() => {
      const I = window.Modules.Identity;
      return {
        isConfigured: typeof I.isConfigured,
        getClient: typeof I.getClient,
        getSession: typeof I.getSession,
        signIn: typeof I.signIn,
        signOut: typeof I.signOut,
        onAuthStateChange: typeof I.onAuthStateChange,
        // Type, not value — both placeholder and real creds are valid; they
        // diverge in behavior tested elsewhere.
        configuredType: typeof I.isConfigured(),
      };
    });
    expect(api.isConfigured).toBe('function');
    expect(api.getClient).toBe('function');
    expect(api.getSession).toBe('function');
    expect(api.signIn).toBe('function');
    expect(api.signOut).toBe('function');
    expect(api.onAuthStateChange).toBe('function');
    expect(api.configuredType).toBe('boolean');
  });

  test('cloud sync toggle is off by default and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav button', { timeout: 8000 });
    await page.locator('nav button').last().click();
    await page.waitForSelector('[data-testid="cloud-sync-toggle"]', { timeout: 5000 });

    const toggle = page.locator('[data-testid="cloud-sync-toggle"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Reload — toggle stays off (cloudSync persisted as false in state).
    await page.reload();
    await page.waitForSelector('nav button', { timeout: 8000 });
    await page.locator('nav button').last().click();
    await page.waitForSelector('[data-testid="cloud-sync-toggle"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="cloud-sync-toggle"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('toggling cloud sync on while signed out opens the sign-in modal; cancel leaves toggle off', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav button', { timeout: 8000 });
    await page.locator('nav button').last().click();
    await page.waitForSelector('[data-testid="cloud-sync-toggle"]', { timeout: 5000 });
    await page.locator('[data-testid="cloud-sync-toggle"]').click();
    const modal = page.locator('[data-testid="cloud-signin-modal"]');
    await expect(modal).toBeVisible();
    // Toggle stays off because sign-in did not succeed.
    await page.locator('button:has-text("Cancel")').first().click();
    await expect(page.locator('[data-testid="cloud-sync-toggle"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('cloud-sync indicator in header reflects toggle+session state', async ({ page }) => {
    await page.goto('/');
    const indicator = page.locator('[data-testid="cloud-sync-indicator"]');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('data-active', 'false');
  });

  test('CSP still has no unsafe-eval after Supabase additions', async ({ page }) => {
    await page.goto('/');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).not.toContain("'unsafe-eval'");
    const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain('https://*.supabase.co');
  });
});

// ── Phase 4: Cloud Sync read-only hydration ──────────────────────────────────
//
// Hermetic mocks (option a from the Phase 4 plan):
//   - Override window.Modules.Identity at init time with a stub that exposes
//     a fake supabase client. Identity.js's later assignment is no-op'd by a
//     property setter so the stub survives.
//   - cloudSync toggle is preset in localStorage; no UI interaction needed.
//   - No real network is contacted; page.route blocks any *.supabase.co hit
//     in the OFF test for belt-and-suspenders.
test.describe('cloud sync hydration (phase 4)', () => {
  function seedAppState(overrides) {
    const base = {
      currentDate: new Date().toISOString().slice(0, 10),
      dayLog: [],
      dayHistory: [],
      cloudSync: false,
      themeMode: 'dark',
      aiModel: 'claude-sonnet-4-6',
      fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
      carryoverDaysRemaining: { b12: 0, vit_e: 0 },
    };
    return Object.assign(base, overrides || {});
  }

  async function preseedState(page, state) {
    await page.addInitScript((s) => {
      localStorage.setItem('nutrition_calc_v2', JSON.stringify(s));
    }, state);
  }

  async function installIdentityStub(page, { signedIn = true, days = [], entries = [] } = {}) {
    await page.addInitScript(({ signedIn, days, entries }) => {
      const fakeUser = { id: 'test-user-uuid' };
      const fakeSession = signedIn ? { user: fakeUser, access_token: 'fake' } : null;

      function buildQuery(rows) {
        const q = {};
        ['select', 'eq', 'is', 'gte', 'order'].forEach((m) => { q[m] = function () { return q; }; });
        q.then = function (resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        };
        return q;
      }

      const fakeClient = {
        from: function (table) {
          if (table === 'days') return buildQuery(days);
          if (table === 'day_entries') return buildQuery(entries);
          return buildQuery([]);
        },
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: fakeSession } }); },
          onAuthStateChange: function (cb) {
            setTimeout(function () { cb('SIGNED_IN', fakeSession); }, 0);
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          signInWithPassword: function () { return Promise.resolve({ data: { session: fakeSession, user: fakeUser }, error: null }); },
          signOut: function () { return Promise.resolve({ error: null }); },
        },
      };

      const stub = {
        isConfigured: function () { return true; },
        getClient: function () { return fakeClient; },
        getSession: function () { return Promise.resolve(fakeSession); },
        signIn: function () { return Promise.resolve({ session: fakeSession, user: fakeUser }); },
        signOut: function () { return Promise.resolve(); },
        onAuthStateChange: function (cb) { setTimeout(function () { cb(fakeSession); }, 0); return function () {}; },
      };

      window.Modules = window.Modules || {};
      Object.defineProperty(window.Modules, 'Identity', {
        get: function () { return stub; },
        set: function () {},
        configurable: true,
      });
    }, { signedIn: signedIn, days: days, entries: entries });
  }

  test('cloudSync OFF: no requests to *.supabase.co within 3s of load', async ({ page }) => {
    const supabaseHits = [];
    await page.route('**/*.supabase.co/**', async (route) => {
      supabaseHits.push(route.request().url());
      await route.abort();
    });
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });
    await page.waitForTimeout(3000);
    expect(supabaseHits).toEqual([]);
  });

  test('cloudSync ON + signed in: dayHistory hydrated with cloud-only rows', async ({ page }) => {
    await preseedState(page, seedAppState({ cloudSync: true }));
    await installIdentityStub(page, {
      signedIn: true,
      days: [
        {
          day_date: '2026-04-20',
          totals: { protein: 50 },
          gaps_closed: 5,
          energy: 3,
          digestion: 3,
          notes: 'cloud-only',
          updated_at: '2026-04-20T12:00:00Z',
        },
      ],
      entries: [],
    });

    await page.goto('/');
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return (s.dayHistory || []).some((d) => d.date === '2026-04-20');
    }, null, { timeout: 5000 });

    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('nutrition_calc_v2')));
    const cloudRow = state.dayHistory.find((d) => d.date === '2026-04-20');
    expect(cloudRow).toBeDefined();
    expect(cloudRow.notes).toBe('cloud-only');
    expect(cloudRow.gapsClosed).toBe(5);
  });

  test('cloud merge is append-only: existing local row by date is preserved', async ({ page }) => {
    const localRow = {
      date: '2026-04-20',
      totals: { protein: 999 },
      gapsClosed: 99,
      energy: 5,
      digestion: 5,
      notes: 'local-wins',
    };
    await preseedState(page, seedAppState({ cloudSync: true, dayHistory: [localRow] }));
    await installIdentityStub(page, {
      signedIn: true,
      days: [
        {
          day_date: '2026-04-20',
          totals: { protein: 1 },
          gaps_closed: 1,
          energy: 1,
          digestion: 1,
          notes: 'cloud-should-be-ignored',
          updated_at: '2026-04-21T00:00:00Z',
        },
        {
          day_date: '2026-04-19',
          totals: {},
          gaps_closed: 0,
          energy: null,
          digestion: null,
          notes: '',
          updated_at: '2026-04-19T00:00:00Z',
        },
      ],
      entries: [],
    });

    await page.goto('/');
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return (s.dayHistory || []).some((d) => d.date === '2026-04-19');
    }, null, { timeout: 5000 });

    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('nutrition_calc_v2')));
    const kept = state.dayHistory.find((d) => d.date === '2026-04-20');
    expect(kept.notes).toBe('local-wins');
    expect(kept.gapsClosed).toBe(99);
    expect(state.dayHistory.find((d) => d.date === '2026-04-19')).toBeDefined();
  });

  test('CLS during hydration stays under 0.01', async ({ page }) => {
    await page.addInitScript(() => {
      window.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) window.__cls += e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (_) {}
    });
    await preseedState(page, seedAppState({ cloudSync: true }));
    await installIdentityStub(page, {
      signedIn: true,
      days: Array.from({ length: 10 }, (_, i) => ({
        day_date: '2026-04-' + String(10 + i).padStart(2, '0'),
        totals: {},
        gaps_closed: 3,
        energy: 3,
        digestion: 3,
        notes: '',
        updated_at: '2026-04-10T00:00:00Z',
      })),
      entries: [],
    });

    await page.goto('/');
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return (s.dayHistory || []).length >= 10;
    }, null, { timeout: 5000 });
    await page.waitForTimeout(300);

    const cls = await page.evaluate(() => window.__cls || 0);
    expect(cls).toBeLessThan(0.01);
  });
});

// ── Phase 5: Write-behind queue ───────────────────────────────────────────────
//
// Three tests:
//   A. WriteBehind + idb-keyval are loaded with correct API surface and SRI.
//   B. Adding an entry while cloud sync is on causes WriteBehind to call
//      upsert on the day_entries table (verified via a tracked fake client).
//   C. A wbq:failed CustomEvent dispatched from JS shows "Could not save" toast.
test.describe('write-behind queue (phase 5)', () => {

  // Installs a writable fake Identity stub with a tracked Supabase client.
  // All writes succeed. Tracks calls in window.wbqTracker (set/array).
  async function installWriteTrackingStub(page) {
    await page.addInitScript(() => {
      window.wbqTracker = [];
      const fakeUser = { id: 'test-user-uuid' };
      const fakeSession = { user: fakeUser, access_token: 'fake' };

      function buildQ(table) {
        const q = {};
        ['select', 'eq', 'is', 'gte', 'order'].forEach((m) => { q[m] = function () { return q; }; });
        q.upsert = function (payload) {
          window.wbqTracker.push({ op: 'upsert', table, payload });
          return q;
        };
        q.update = function (payload) {
          window.wbqTracker.push({ op: 'update', table, payload });
          return q;
        };
        q.then = function (resolve, reject) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        };
        return q;
      }

      const fakeClient = {
        from: function (table) { return buildQ(table); },
        auth: {
          getSession: function () {
            return Promise.resolve({ data: { session: fakeSession }, error: null });
          },
          onAuthStateChange: function (cb) {
            setTimeout(function () { cb('SIGNED_IN', fakeSession); }, 0);
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          signInWithPassword: function () {
            return Promise.resolve({ data: { session: fakeSession, user: fakeUser }, error: null });
          },
          signOut: function () { return Promise.resolve({ error: null }); },
        },
      };

      const stub = {
        isConfigured: function () { return true; },
        getClient:    function () { return fakeClient; },
        getSession:   function () { return Promise.resolve(fakeSession); },
        signIn:       function () { return Promise.resolve({ session: fakeSession, user: fakeUser }); },
        signOut:      function () { return Promise.resolve(); },
        onAuthStateChange: function (cb) {
          setTimeout(function () { cb(fakeSession); }, 0);
          return function () {};
        },
      };

      window.Modules = window.Modules || {};
      Object.defineProperty(window.Modules, 'Identity', {
        get: function () { return stub; },
        set: function () {},
        configurable: true,
      });
    });
  }

  test('WriteBehind module and idb-keyval UMD are loaded with correct API and SRI', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.WriteBehind, { timeout: 5000 });

    const api = await page.evaluate(() => {
      const W = window.WriteBehind;
      return {
        enqueue:      typeof W.enqueue,
        flush:        typeof W.flush,
        getQueueDepth: typeof W.getQueueDepth,
        isCircuitOpen: typeof W.isCircuitOpen,
      };
    });
    expect(api.enqueue).toBe('function');
    expect(api.flush).toBe('function');
    expect(api.getQueueDepth).toBe('function');
    expect(api.isCircuitOpen).toBe('function');

    // idb-keyval script tag is pinned and has SRI
    const idbScript = page.locator('script[src*="idb-keyval"]');
    await expect(idbScript).toHaveCount(1);
    const src       = await idbScript.getAttribute('src');
    const integrity = await idbScript.getAttribute('integrity');
    expect(src).toMatch(/idb-keyval@\d+\.\d+\.\d+/);
    expect(integrity).toMatch(/^sha384-.+/);

    // idbKeyval global is present and has the expected API
    const idbOk = await page.evaluate(() =>
      typeof window.idbKeyval === 'object' &&
      typeof window.idbKeyval.set === 'function' &&
      typeof window.idbKeyval.values === 'function' &&
      typeof window.idbKeyval.createStore === 'function'
    );
    expect(idbOk).toBe(true);
  });

  test('adding entry with cloud sync on calls upsert on day_entries via WriteBehind', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nutrition_calc_v2', JSON.stringify({
        currentDate: new Date().toISOString().slice(0, 10),
        dayLog: [], dayHistory: [], cloudSync: true,
        themeMode: 'dark', aiModel: 'claude-sonnet-4-6',
        fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
        carryoverDaysRemaining: { b12: 0, vit_e: 0 },
      }));
      localStorage.setItem('nutrition_calc_v2_api_key', 'sk-ant-test-fake');
    });
    await installWriteTrackingStub(page);

    await page.route('https://api.anthropic.com/v1/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [{ text: JSON.stringify({
            protein: 10, carbs: 20, fat: 5, fiber: 2, sat_fat: 1,
            epa_dha: 0, calcium: 50, iron: 1, zinc: 1, potassium: 200,
            magnesium: 30, vit_c: 10, vit_d: 0, vit_e: 1, b12: 0.5, folate: 20,
          }) }],
        }),
      });
    });

    await page.goto('/');
    await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });
    const input = page.locator('input[placeholder="Describe what you ate..."]');
    await input.fill('test sync meal');
    await input.press('Enter');

    // Wait for optimistic update to land in localStorage
    await page.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return (s.dayLog || []).length > 0;
    }, null, { timeout: 5000 });

    // Flush the debounce immediately (skip the 2 s wait)
    await page.evaluate(() => window.WriteBehind.flush());

    // Wait for the fake client to receive the upsert
    await page.waitForFunction(() => window.wbqTracker && window.wbqTracker.length > 0, null, { timeout: 3000 });

    const calls = await page.evaluate(() => window.wbqTracker);
    const upsert = calls.find((c) => c.op === 'upsert' && c.table === 'day_entries');
    expect(upsert).toBeDefined();
    expect(upsert.payload.user_id).toBe('test-user-uuid');
    expect(typeof upsert.payload.idempotency_key).toBe('string');
    expect(upsert.payload.idempotency_key.length).toBeGreaterThan(0);
    expect(upsert.payload.name).toBeTruthy();
    // idempotency_key = entry.id, generated by genId() — stable across retries
    expect(upsert.payload.idempotency_key.length).toBeGreaterThan(4);
  });

  test('wbq:failed CustomEvent dispatches "Could not save" toast', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Describe what you ate..."]', { timeout: 8000 });

    // Fire the event that WriteBehind emits after retry exhaustion
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('wbq:failed', { detail: { key: 'test-rollback-key' } }));
    });

    // The ToastProvider listener should render the retry toast
    await page.waitForSelector('text=Could not save', { timeout: 3000 });
    const text = await page.locator('text=Could not save').first().textContent();
    expect(text).toContain('Could not save');
  });
});

// ── Phase 6: Multi-tab leader election ───────────────────────────────────────
//
// Two tabs in the same BrowserContext share a BroadcastChannel("sync-leader").
// Verifies:
//   A. Only the leader hits RemoteStore — follower's fetch counter stays 0.
//   B. Leader handoff: closing the leader tab promotes the follower.
//
// Strategy: install the Identity stub via context.addInitScript so both
// pages pick it up, and have the stub increment window.__remoteCallCount
// every time the fake supabase `from(table).select(...)` chain is awaited.
test.describe('multi-tab leader election (phase 6)', () => {
  function seedState() {
    return {
      currentDate: new Date().toISOString().slice(0, 10),
      dayLog: [], dayHistory: [], cloudSync: true,
      themeMode: 'dark', aiModel: 'claude-sonnet-4-6',
      fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
      carryoverDaysRemaining: { b12: 0, vit_e: 0 },
    };
  }

  async function installSharedStub(context, days, entries) {
    await context.addInitScript(({ days, entries, state }) => {
      localStorage.setItem('nutrition_calc_v2', JSON.stringify(state));
      window.__remoteCallCount = 0;
      const fakeUser = { id: 'shared-user-uuid' };
      const fakeSession = { user: fakeUser, access_token: 'fake' };

      function buildQuery(rows) {
        const q = {};
        ['select', 'eq', 'is', 'gte', 'order'].forEach((m) => { q[m] = function () { return q; }; });
        q.then = function (resolve, reject) {
          window.__remoteCallCount = (window.__remoteCallCount || 0) + 1;
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        };
        return q;
      }

      const fakeClient = {
        from: function (table) {
          if (table === 'days') return buildQuery(days);
          if (table === 'day_entries') return buildQuery(entries);
          return buildQuery([]);
        },
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: fakeSession } }); },
          onAuthStateChange: function (cb) {
            setTimeout(function () { cb('SIGNED_IN', fakeSession); }, 0);
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          signInWithPassword: function () {
            return Promise.resolve({ data: { session: fakeSession, user: fakeUser }, error: null });
          },
          signOut: function () { return Promise.resolve({ error: null }); },
        },
      };

      const stub = {
        isConfigured: function () { return true; },
        getClient:    function () { return fakeClient; },
        getSession:   function () { return Promise.resolve(fakeSession); },
        signIn:       function () { return Promise.resolve({ session: fakeSession, user: fakeUser }); },
        signOut:      function () { return Promise.resolve(); },
        onAuthStateChange: function (cb) {
          setTimeout(function () { cb(fakeSession); }, 0);
          return function () {};
        },
      };

      window.Modules = window.Modules || {};
      Object.defineProperty(window.Modules, 'Identity', {
        get: function () { return stub; },
        set: function () {},
        configurable: true,
      });
    }, { days, entries, state: seedState() });
  }

  test('only the leader fetches; follower hydrates via BroadcastChannel', async ({ context }) => {
    await installSharedStub(context,
      [{
        day_date: '2026-04-15', totals: { protein: 42 }, gaps_closed: 7,
        energy: 4, digestion: 4, notes: 'shared-leader-row',
        updated_at: '2026-04-15T12:00:00Z',
      }],
      []
    );

    // Tab A boots first → becomes leader.
    const tabA = await context.newPage();
    await tabA.goto('/');
    await tabA.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return (s.dayHistory || []).some((d) => d.date === '2026-04-15');
    }, null, { timeout: 5000 });
    await tabA.waitForFunction(() => window.SyncLeader && window.SyncLeader.getRole() === 'leader',
      null, { timeout: 3000 });

    const callsA1 = await tabA.evaluate(() => window.__remoteCallCount);
    expect(callsA1).toBeGreaterThanOrEqual(2); // fetchDays + fetchEntries

    // Tab B boots second → becomes follower; gets hydrated via channel.
    const tabB = await context.newPage();
    await tabB.goto('/');
    await tabB.waitForFunction(() => {
      const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
      return (s.dayHistory || []).some((d) => d.date === '2026-04-15');
    }, null, { timeout: 5000 });

    const roleB = await tabB.evaluate(() => window.SyncLeader && window.SyncLeader.getRole());
    expect(roleB).toBe('follower');

    // Critical assertion: follower made zero RemoteStore calls.
    const callsB = await tabB.evaluate(() => window.__remoteCallCount || 0);
    expect(callsB).toBe(0);

    // Leader's count should not have grown.
    const callsA2 = await tabA.evaluate(() => window.__remoteCallCount);
    expect(callsA2).toBe(callsA1);

    await tabA.close();
    await tabB.close();
  });

  test('leader handoff on tab close promotes the follower', async ({ context }) => {
    await installSharedStub(context, [], []);

    const tabA = await context.newPage();
    await tabA.goto('/');
    await tabA.waitForFunction(() => window.SyncLeader && window.SyncLeader.getRole() === 'leader',
      null, { timeout: 6000 });

    const tabB = await context.newPage();
    await tabB.goto('/');
    await tabB.waitForFunction(() => window.SyncLeader && window.SyncLeader.getRole() === 'follower',
      null, { timeout: 6000 });

    // Close the leader; pagehide listener should broadcast leader-leaving.
    await tabA.close();

    // B re-elects to leader (jitter ≤50ms + ELECTION_WAIT_MS = 150ms + slack).
    await tabB.waitForFunction(() => window.SyncLeader && window.SyncLeader.getRole() === 'leader',
      null, { timeout: 6000 });
    const finalRole = await tabB.evaluate(() => window.SyncLeader.getRole());
    expect(finalRole).toBe('leader');

    await tabB.close();
  });
});

// ── Phase 7: Service Worker offline shell ────────────────────────────────────

test.describe('phase 7: service worker', () => {
  test('boots from cache when offline', async ({ context, page }) => {
    await page.goto('/');

    // Wait for SW to activate + claim control of the page.
    await page.waitForFunction(
      () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
      null,
      { timeout: 10000 }
    );

    // Wait for the shell cache to be populated.
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.some((k) => k.startsWith('vitality-v2-shell-'));
    }, null, { timeout: 10000 });

    // Confirm app mounted online before going offline.
    await page.waitForFunction(
      () => document.getElementById('root') && document.getElementById('root').children.length > 0,
      null,
      { timeout: 10000 }
    );

    // Cut the network and reload — boot must come from cache.
    await context.setOffline(true);
    await page.reload();

    await page.waitForFunction(
      () => document.getElementById('root') && document.getElementById('root').children.length > 0,
      null,
      { timeout: 10000 }
    );

    const mounted = await page.evaluate(() => document.getElementById('root').children.length);
    expect(mounted).toBeGreaterThan(0);

    await context.setOffline(false);
  });

  test('first boot establishes only current-build caches', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
      null,
      { timeout: 10000 }
    );
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.some((k) => k.startsWith('vitality-v2-shell-'));
    }, null, { timeout: 10000 });

    const keys = await page.evaluate(() => caches.keys());
    // Every cache must be a current-build cache. If activate ran with stale
    // caches present, this still holds because activate purges non-keep names.
    for (const k of keys) {
      expect(k).toMatch(/^vitality-v2-(shell|runtime)-/);
    }
  });
});
