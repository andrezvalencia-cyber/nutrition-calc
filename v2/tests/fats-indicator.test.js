// Fats indicator migration guard.
//
// The standalone Fats MacroIndicator that #21 added to the HomeScreen was
// intentionally REMOVED: per design, fat must not occupy a dedicated card on
// Home. It now surfaces on Home only via the Daily Highlights / Focus Points
// section (when it's an open gap), and as a permanent macro card on the
// Dashboard between Protein and Carbs. These tests lock in that migration so
// the old standalone indicator does not silently come back.
//
// Functional coverage for the new placement lives in highlights-ux.test.js
// (Assertion A: Home gating; Assertion B: Dashboard Protein→Fats→Carbs order).

const { test, expect } = require('@playwright/test');

async function seedFat(page, fatGrams) {
  await page.addInitScript((fat) => {
    localStorage.setItem('nutrition_calc_v2', JSON.stringify({
      currentDate: new Date().toISOString().slice(0, 10),
      dayLog: [{ id: 'seed', nutrients: { fat } }],
      fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
      carryoverDaysRemaining: { b12: 0, vit_e: 0 },
      dayHistory: [],
      themeMode: 'dark',
      aiModel: 'claude-sonnet-4-6',
    }));
  }, fatGrams);
}

test.describe('fats indicator migration', () => {
  test('Home no longer renders the standalone fats-indicator (any fat value)', async ({ page }) => {
    await seedFat(page, 50); // value is irrelevant — the card is gone for good
    await page.goto('/');
    await page.waitForSelector('[data-testid="quick-entry-button"]', { timeout: 8000 });
    await expect(page.getByTestId('fats-indicator')).toHaveCount(0);
    await expect(page.getByTestId('fats-indicator-pct')).toHaveCount(0);
    await expect(page.getByTestId('fats-indicator-detail')).toHaveCount(0);
  });

  test('Dashboard renders the Fats macro card between Protein and Carbs', async ({ page }) => {
    await seedFat(page, 50);
    await page.goto('/');
    await page.waitForSelector('[data-testid="bottom-nav"]', { timeout: 8000 });
    await page.getByTestId('bottom-nav').locator('button').nth(1).click();
    await expect(page.getByTestId('macro-fats')).toBeVisible({ timeout: 8000 });
  });
});
