// Onboarding + template-driven logging integration tests (Playwright).
// Requires a static server on :8765 (see playwright.config.js / CLAUDE.md §Env).
const { test, expect } = require('@playwright/test');

const RING = 'svg circle[stroke="url(#primaryGradient)"]';
const ADD_BTN = 'button:has-text("add_circle")';
const SHEET = 'h2:has-text("Log Entry")';

function baseState(extra) {
  return Object.assign({
    currentDate: new Date().toISOString().slice(0, 10),
    dayLog: [],
    templates: [],
    onboarded: true,
    fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
    carryoverDaysRemaining: { b12: 0, vit_e: 0 },
    dayHistory: [],
    themeMode: 'dark',
    aiModel: 'claude-sonnet-4-6',
    cloudSync: false,
  }, extra || {});
}

async function openSheet(page) {
  await page.locator(ADD_BTN).first().click();
  await page.waitForSelector(SHEET, { timeout: 8000 });
}

// ── First-run seeding ────────────────────────────────────────────────────────
test('first run seeds example templates and the progress ring renders', async ({ page }) => {
  // Simulate a brand-new user: no persisted state at all.
  await page.addInitScript(() => {
    try { localStorage.removeItem('nutrition_calc_v2'); } catch (e) {}
  });
  await page.goto('/');
  await page.waitForSelector(RING, { timeout: 8000 });

  // onboarded flag flips and templates persist to localStorage.
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
    return s.onboarded === true && Array.isArray(s.templates) && s.templates.length >= 1;
  }, null, { timeout: 5000 });

  await openSheet(page);
  await expect(page.getByText('Standard Breakfast')).toBeVisible();
  await expect(page.getByText('Morning Vitality')).toBeVisible();
  const chips = page.locator('[data-testid="item-chip"]');
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
});

// ── Persistence parity: exact id + emoji survive a reload ────────────────────
test('a custom template persists across reload with the exact id and emoji', async ({ page }) => {
  // Seed ONLY if absent, so the reload keeps the template the user creates.
  await page.addInitScript(() => {
    if (!localStorage.getItem('nutrition_calc_v2')) {
      localStorage.setItem('nutrition_calc_v2', JSON.stringify({
        currentDate: new Date().toISOString().slice(0, 10),
        dayLog: [], templates: [], onboarded: true,
        fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
        carryoverDaysRemaining: { b12: 0, vit_e: 0 },
        dayHistory: [], themeMode: 'dark', aiModel: 'claude-sonnet-4-6', cloudSync: false,
      }));
    }
  });
  await page.goto('/');
  await page.waitForSelector(RING, { timeout: 8000 });

  await openSheet(page);
  await page.getByRole('button', { name: /^\S+\s+Lunch$/ }).click();
  await page.locator('[data-testid="create-template"]').click();
  await page.locator('[data-testid="template-name-input"]').fill('My Lunch Combo');
  await page.locator('[data-testid="template-save"]').click();

  // Capture the persisted id + emoji.
  const handle = await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}');
    const t = (s.templates || []).find((x) => x.name === 'My Lunch Combo');
    return t ? { id: t.id, emoji: t.emoji } : null;
  }, null, { timeout: 5000 });
  const { id, emoji } = await handle.jsonValue();
  expect(id).toBeTruthy();

  // Reload, reopen, and search to find the template (may be beyond the 6-item slice).
  await page.reload();
  await page.waitForSelector(RING, { timeout: 8000 });
  await openSheet(page);
  await page.locator('[data-testid="log-search"]').fill('My Lunch Combo');
  const chip = page.locator(`[data-testid="item-chip"][data-item-id="${id}"]`);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('My Lunch Combo');
  await expect(chip).toContainText(emoji);
});

// ── Degraded oracle: a broken template never crashes the tree ────────────────
test('a template referencing a missing recipe renders degraded, not crashed', async ({ page }) => {
  await page.addInitScript((state) => {
    localStorage.setItem('nutrition_calc_v2', JSON.stringify(state));
  }, baseState({
    templates: [{
      id: 'tpl_broken', name: 'Broken Combo', emoji: 'X',
      refs: [{ recipeId: 'does_not_exist', ingredientStates: [] }],
      createdAt: 0,
    }],
  }));
  await page.goto('/');

  // App still mounts — no torn component tree.
  await page.waitForSelector(RING, { timeout: 8000 });
  await expect(page.locator('#root')).not.toBeEmpty();

  await openSheet(page);
  const chip = page.locator('[data-testid="item-chip"][data-item-id="tpl_broken"]');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-degraded', 'true');
  await expect(chip).toBeDisabled();

  // A degraded chip is non-interactive (disabled) — rendering logged nothing.
  const dayLogLen = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('nutrition_calc_v2') || '{}').dayLog || []).length
  );
  expect(dayLogLen).toBe(0);
});
