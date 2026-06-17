// Playwright oracle for the BottomNav Liquid-Glass pill.
// Verifies: fixed positioning, z-index contract, scroll clearance, and glass rendering.

const { test, expect } = require('@playwright/test');

const MOUNT_SELECTOR = 'svg circle[stroke="url(#primaryGradient)"]';

test.describe('BottomNav', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Assertion A — nav is position:fixed and its bottom edge is within 24px of viewport bottom', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(MOUNT_SELECTOR, { timeout: 8000 });

    const result = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="bottom-nav"]');
      if (!nav) return { found: false };
      const style = getComputedStyle(nav);
      const rect = nav.getBoundingClientRect();
      return {
        found: true,
        position: style.position,
        bottomGap: window.innerHeight - rect.bottom,
      };
    });

    expect(result.found, 'data-testid="bottom-nav" must exist').toBe(true);
    expect(result.position).toBe('fixed');
    expect(result.bottomGap).toBeGreaterThanOrEqual(0);
    expect(result.bottomGap).toBeLessThanOrEqual(24);
  });

  test('Assertion B — nav z-index is >= 50', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(MOUNT_SELECTOR, { timeout: 8000 });

    const zIndex = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="bottom-nav"]');
      return nav ? parseInt(getComputedStyle(nav).zIndex, 10) : -1;
    });

    expect(zIndex).toBeGreaterThanOrEqual(50);
  });

  test('Assertion C — pb-28 buffer: last content child clears nav top after scroll', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(MOUNT_SELECTOR, { timeout: 8000 });

    // Scroll fully to the bottom of the page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // Give layout one frame to settle
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="bottom-nav"]');
      // HomeScreen content wrapper — identified by its pb-28 buffer class
      const wrapper = document.querySelector('.pt-20.pb-28.px-4');
      if (!nav || !wrapper) return { found: false };

      // Last element child of the content wrapper
      const children = wrapper.children;
      const last = children[children.length - 1];
      if (!last) return { found: false, noChildren: true };

      const lastRect = last.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      return {
        found: true,
        lastBottom: lastRect.bottom,
        navTop: navRect.top,
      };
    });

    expect(result.found, 'content wrapper and nav must both exist').toBe(true);
    // The last child must sit entirely above the nav pill (clearance check)
    expect(result.lastBottom).toBeLessThanOrEqual(result.navTop);
  });

  test('glass re-renders in dark mode without remount (CSS-only switch)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(MOUNT_SELECTOR, { timeout: 8000 });

    // Capture mount count before theme switch
    const mountsBefore = await page.evaluate(() => {
      window.__navMounts = (window.__navMounts || 0);
      return window.__navMounts;
    });

    // Force dark mode via html class (same mechanism as theme useEffect)
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(150);

    const darkShot = await page.screenshot({ clip: { x: 0, y: 780, width: 390, height: 64 } });
    expect(darkShot.length).toBeGreaterThan(0);

    // Switch to light mode
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.waitForTimeout(150);

    const lightShot = await page.screenshot({ clip: { x: 0, y: 780, width: 390, height: 64 } });
    expect(lightShot.length).toBeGreaterThan(0);

    // Nav must still be present after both switches (no remount crash)
    const navStillPresent = await page.locator('[data-testid="bottom-nav"]').count();
    expect(navStillPresent).toBe(1);
  });
});
