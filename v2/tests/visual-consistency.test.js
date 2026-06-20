const { test, expect } = require('@playwright/test');

test.describe('LogDaySheet entry grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=Vitality', { timeout: 5000 });
  });

  async function openLogSheet(page) {
    const addBtn = page.getByTestId('quick-entry-button');
    await addBtn.waitFor({ timeout: 5000 });
    await addBtn.click();
    await expect(page.locator('h2:has-text("Log Entry")')).toBeVisible({ timeout: 3000 });
  }

  test('entry grid renders as 3-column bounded grid', async ({ page }) => {
    await openLogSheet(page);
    const grid = page.getByTestId('entry-grid');
    await expect(grid).toBeVisible();

    const box = await grid.boundingBox();
    const viewport = page.viewportSize();
    const ratio = box.height / viewport.height;
    expect(ratio).toBeGreaterThanOrEqual(0.15);
    expect(ratio).toBeLessThanOrEqual(0.85);
  });

  test('grid contains New food cell + item cells', async ({ page }) => {
    await openLogSheet(page);
    const newFoodCell = page.getByTestId('new-custom-food');
    await expect(newFoodCell).toBeVisible();
    await expect(newFoodCell).toHaveAccessibleName(/new or edit food/i);

    const chips = page.getByTestId('item-chip');
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(17);
  });

  test('edit toggle is in grid footer', async ({ page }) => {
    await openLogSheet(page);
    const editBtn = page.getByTestId('edit-toggle');
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await expect(editBtn).toHaveText('Done');

    const chips = page.getByTestId('item-chip');
    if (await chips.count() > 0) {
      const firstChip = chips.first();
      await expect(firstChip).toHaveClass(/animate-jiggle/);
    }

    await editBtn.click();
    await expect(editBtn).toContainText('Edit');
  });

  test('search enter-to-log button appears on query', async ({ page }) => {
    await openLogSheet(page);
    const search = page.getByTestId('log-search');
    await search.fill('test');
    const submitBtn = page.getByTestId('log-submit');
    await expect(submitBtn).toBeVisible();
  });

  test('food count shows in header on meals tab', async ({ page }) => {
    await openLogSheet(page);
    await expect(page.locator('text=/\\d+ \\/ 17 foods/')).toBeVisible();
  });

  test('supplements tab renders grid style', async ({ page }) => {
    await openLogSheet(page);
    const suppTab = page.locator('button:has-text("Supplements")');
    await suppTab.click();
    const suppPills = page.getByTestId('supp-pills');
    await expect(suppPills).toBeVisible();
  });

  test('cross-browser entry grid screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('text=Vitality', { timeout: 5000 });
    await openLogSheet(page);
    const grid = page.getByTestId('entry-grid');
    await expect(grid).toHaveScreenshot('entry-grid.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
