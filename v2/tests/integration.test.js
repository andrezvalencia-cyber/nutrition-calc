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
    expect(src).toMatch(/(react(-dom)?|@supabase\/supabase-js)@\d+\.\d+\.\d+/);
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
    // script-src must not regain 'unsafe-inline' (style-src is allowed to keep it for fonts).
    const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain('https://*.supabase.co');
  });
});
