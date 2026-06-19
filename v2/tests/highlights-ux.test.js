// Highlights / Quick-Entry UX tests
// Verifies (A) Home has no standalone Fats card — fat surfaces only via Daily Highlights,
// (B) the Dashboard macro row is always Protein → Fats → Carbs, and
// (C) the Quick Entry button opens LogDaySheet with the search field focused but empty.

const { test, expect } = require('@playwright/test');

// Seed app state so runningTotals = sum(dayLog[].nutrients). Fat objective is range 65–85g:
//   fat < 65  → open gap (a "highlight");  65 ≤ fat ≤ 85 → closed (not a highlight).
async function seedFat(page, fatGrams) {
  await page.addInitScript((fat) => {
    localStorage.setItem('nutrition_calc_v2', JSON.stringify({
      currentDate: new Date().toISOString().slice(0, 10),
      dayLog: [{ id: 'seed', recipeId: null, name: 'Seed', emoji: '🍽', nutrients: { fat }, timestamp: Date.now() }],
      templates: [],
      customFoods: [],
      fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
      carryoverDaysRemaining: { b12: 0, vit_e: 0 },
      dayHistory: [],
      themeMode: 'dark',
      aiModel: 'claude-sonnet-4-6',
      onboardingProfile: null,
    }));
  }, fatGrams);
}

// ── Assertion A: Home never shows a standalone Fats card; fat appears only when it's a highlight ──

test('A1: fat is a highlight (low) → no standalone Fats card, fat shows in Daily Highlights', async ({ page }) => {
  await seedFat(page, 5); // below 65g ⇒ open gap
  await page.goto('/');
  await page.waitForSelector('[data-testid="quick-entry-button"]', { timeout: 8000 });

  // The deleted standalone Fats MacroIndicator must not exist anywhere on Home.
  await expect(page.getByTestId('fats-indicator')).toHaveCount(0);
  // Fat surfaces only via the Daily Highlights / Focus Points section.
  await expect(page.getByText('Total Fat', { exact: true })).toBeVisible();
});

test('A2: fat is NOT a highlight (in range) → no standalone Fats card, fat absent from Daily Highlights', async ({ page }) => {
  await seedFat(page, 75); // within 65–85g ⇒ gap closed
  await page.goto('/');
  await page.waitForSelector('[data-testid="quick-entry-button"]', { timeout: 8000 });

  await expect(page.getByTestId('fats-indicator')).toHaveCount(0);
  await expect(page.getByText('Total Fat', { exact: true })).toHaveCount(0);
});

// ── Assertion B: Dashboard always renders Protein → Fats → Carbs in order ──

test('B: Dashboard macro row order is Protein, Fats, Carbs', async ({ page }) => {
  await seedFat(page, 75); // fat value is irrelevant — the row is always-on
  await page.goto('/');
  await page.waitForSelector('[data-testid="bottom-nav"]', { timeout: 8000 });

  // Bottom-nav tabs: home(0), dashboard(1), insights(2), settings(3).
  await page.getByTestId('bottom-nav').locator('button').nth(1).click();
  await page.waitForSelector('[data-testid="macro-fats"]', { timeout: 8000 });

  const order = await page
    .locator('[data-testid^="macro-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order).toEqual(['macro-protein', 'macro-fats', 'macro-carbs']);
});

// ── Assertion C: Quick Entry opens LogDaySheet, search focused but empty ──

test('C: Quick Entry button opens the log sheet with the search field focused and empty', async ({ page }) => {
  await seedFat(page, 75);
  await page.goto('/');
  await page.waitForSelector('[data-testid="quick-entry-button"]', { timeout: 8000 });

  await page.getByTestId('quick-entry-button').click();

  const search = page.getByTestId('log-search');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
});
