// Playwright integration tests for multi-modal food entry in LogDaySheet.
// Tests: search filtering, barcode scan flow, custom food CRUD + persistence.

const { test, expect } = require("@playwright/test");

// Helper: open the LogDaySheet by clicking the add_circle icon in the
// quick-entry bar. The home tab is the default on load. The "+" button
// (add_circle icon) triggers onOpenLog → setShowLogSheet(true).
// Double-tapping the "Log" bottom-nav tab also works as a fallback.
async function openLogSheet(page) {
  await page.goto("/");
  await page.waitForSelector('[data-testid="bottom-nav"]', { timeout: 8000 });

  // Primary path: the add_circle button next to the quick-entry input.
  // It's the button whose Icon child renders "add_circle" text.
  const addBtn = page.locator('button:has(span.material-symbols-outlined:text("add_circle"))').first();
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.click();
  } else {
    // Fallback: double-click the "Log" tab in bottom nav to toggle the sheet
    const logTab = page.locator('[data-testid="bottom-nav"] button').first();
    await logTab.click();
    await page.waitForTimeout(100);
    await logTab.click();
  }
  await page.waitForSelector('[data-testid="log-search"]', { timeout: 5000 });
}

// ── A: Search filtering ─────────────────────────────────────────────────────

test("search filters meal pills by name", async ({ page }) => {
  await openLogSheet(page);

  // Before search: multiple pills visible
  const allPills = page.locator('[data-testid="meal-pills"] button');
  const countBefore = await allPills.count();
  expect(countBefore).toBeGreaterThan(1);

  // Type "Shake" — should filter to matching pills only
  await page.fill('[data-testid="log-search"]', "Shake");
  await page.waitForTimeout(200);

  const filtered = page.locator('[data-testid="meal-pills"] button');
  const countAfter = await filtered.count();
  expect(countAfter).toBeLessThan(countBefore);
  expect(countAfter).toBeGreaterThan(0);

  // Every visible pill name should contain "Shake" (case-insensitive)
  const names = await filtered.allTextContents();
  for (const name of names) {
    expect(name.toLowerCase()).toContain("shake");
  }
});

// ── B: Scan flow ─────────────────────────────────────────────────────────────

test("scan decode populates search and opens wizard on no match", async ({ page }) => {
  // Stub Scanner before page loads
  await page.addInitScript(() => {
    window.Modules = window.Modules || {};
    Object.defineProperty(window.Modules, "Scanner", {
      get: () => ({
        isSupported: () => true,
        requestCamera: () => Promise.resolve(),
        start: (viewportId, opts) => {
          // Fire onDecode with a barcode that won't match any recipe name
          setTimeout(() => opts.onDecode("SCAN-999-NOMATCH"), 100);
          return Promise.resolve();
        },
        stop: () => {},
      }),
      set: () => {},
      configurable: true,
    });
  });

  await openLogSheet(page);

  // Scan trigger should be visible
  const scanBtn = page.locator('[data-testid="scan-trigger"]');
  await expect(scanBtn).toBeVisible();
  await scanBtn.click();

  // After scan decodes with no match → wizard should open with barcode prefilled
  await page.waitForSelector('[data-testid="custom-food-wizard"]', { timeout: 5000 });
  const barcodeRef = page.locator('text=SCAN-999-NOMATCH');
  await expect(barcodeRef).toBeVisible();
});

// ── C: Custom Food CRUD + persistence ────────────────────────────────────────

test("create custom food via wizard, appears in grid, survives reload", async ({ page }) => {
  await openLogSheet(page);

  // Click the "+" button to open wizard
  await page.click('[data-testid="new-custom-food"]');
  await page.waitForSelector('[data-testid="custom-food-wizard"]', { timeout: 5000 });

  // Fill in the name and a nutrient
  await page.fill('[data-testid="cf-name"]', "Test Shake");
  await page.fill('[data-testid="cf-protein"]', "25");
  await page.fill('[data-testid="cf-carbs"]', "30");

  // Save
  await page.click('[data-testid="cf-save"]');

  // Wizard should close, custom food pill should appear
  await page.waitForSelector('[data-testid="custom-food-wizard"]', { state: "detached", timeout: 3000 });

  // Re-open LogDaySheet to see the pill
  await openLogSheet(page);
  const pill = page.locator('[data-testid="custom-food-chip"]:has-text("Test Shake")');
  await expect(pill).toBeVisible({ timeout: 3000 });

  // Reload and verify persistence (localStorage)
  await page.reload();
  await openLogSheet(page);
  const pillAfterReload = page.locator('[data-testid="custom-food-chip"]:has-text("Test Shake")');
  await expect(pillAfterReload).toBeVisible({ timeout: 5000 });
});
