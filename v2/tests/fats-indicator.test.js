const { test, expect } = require('@playwright/test');

const ZERO_NUTRIENTS = {
  protein: 0, carbs: 0, fat: 0, fiber: 0, sat_fat: 0, epa_dha: 0,
  calcium: 0, iron: 0, zinc: 0, vit_d: 0, vit_e: 0, b12: 0,
  folate: 0, vit_c: 0, potassium: 0, magnesium: 0,
};

function buildState(overrides) {
  return Object.assign({
    currentDate: new Date().toISOString().slice(0, 10),
    dayLog: [],
    dayHistory: [],
    cloudSync: false,
    themeMode: 'dark',
    aiModel: 'claude-sonnet-4-6',
    fatSolubleCarryover: { b12: 0, vit_e: 0, vit_d: 0 },
    carryoverDaysRemaining: { b12: 0, vit_e: 0 },
  }, overrides);
}

async function seedState(page, state) {
  await page.addInitScript((s) => {
    localStorage.setItem('nutrition_calc_v2', JSON.stringify(s));
  }, state);
}

async function installIdentityStub(page) {
  await page.addInitScript(() => {
    const fakeUser = { id: 'test-user-uuid' };
    const fakeSession = { user: fakeUser, access_token: 'fake' };

    function buildQuery(rows) {
      const q = {};
      ['select', 'eq', 'is', 'gte', 'order'].forEach((m) => { q[m] = function () { return q; }; });
      q.then = function (resolve, reject) {
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      };
      return q;
    }

    const fakeClient = {
      from: function () { return buildQuery([]); },
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
  });
}

test.describe('fats macro indicator', () => {
  test('A — indicator is visible when signed in with fat in dayLog', async ({ page }) => {
    await installIdentityStub(page);
    await seedState(page, buildState({
      cloudSync: true,
      dayLog: [{ id: 'a1', name: 'Avocado', nutrients: { ...ZERO_NUTRIENTS, fat: 20 } }],
    }));
    await page.goto('/');
    await expect(page.locator('[data-testid="fats-indicator"]')).toBeVisible({ timeout: 8000 });
  });

  test('B — math: 50g consumed / 100g target = 50%', async ({ page }) => {
    await installIdentityStub(page);
    await seedState(page, buildState({
      cloudSync: true,
      profile: { fat: 100 },
      dayLog: [{ id: 'b1', name: 'Oil', nutrients: { ...ZERO_NUTRIENTS, fat: 50 } }],
    }));
    await page.goto('/');
    await expect(page.locator('[data-testid="fats-indicator-pct"]')).toHaveText('50%', { timeout: 8000 });
  });

  test('C — resilience: profile.fat=0 does not crash (unity guard)', async ({ page }) => {
    await installIdentityStub(page);
    await seedState(page, buildState({
      cloudSync: true,
      profile: { fat: 0 },
      dayLog: [{ id: 'c1', name: 'Oil', nutrients: { ...ZERO_NUTRIENTS, fat: 50 } }],
    }));
    await page.goto('/');
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 8000 });
    const pctText = await page.locator('[data-testid="fats-indicator-pct"]').textContent();
    expect(pctText).toMatch(/^\d+%$/);
    const detail = await page.locator('[data-testid="fats-indicator-detail"]').textContent();
    expect(detail).toContain('/ 1g');
  });

  test('D — detail format: 50g / 100g with correct unit', async ({ page }) => {
    await installIdentityStub(page);
    await seedState(page, buildState({
      cloudSync: true,
      profile: { fat: 100 },
      dayLog: [{ id: 'd1', name: 'Oil', nutrients: { ...ZERO_NUTRIENTS, fat: 50 } }],
    }));
    await page.goto('/');
    await expect(page.locator('[data-testid="fats-indicator-detail"]')).toHaveText('50g / 100g', { timeout: 8000 });
  });

  test('ARIA — progressbar role with aria-valuenow and aria-valuetext', async ({ page }) => {
    await installIdentityStub(page);
    await seedState(page, buildState({
      cloudSync: true,
      profile: { fat: 100 },
      dayLog: [{ id: 'e1', name: 'Oil', nutrients: { ...ZERO_NUTRIENTS, fat: 50 } }],
    }));
    await page.goto('/');
    const indicator = page.locator('[data-testid="fats-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 8000 });
    await expect(indicator).toHaveAttribute('role', 'progressbar');
    const valueNow = await indicator.getAttribute('aria-valuenow');
    expect(Number(valueNow)).toBeGreaterThanOrEqual(0);
    expect(Number(valueNow)).toBeLessThanOrEqual(100);
    const valueText = await indicator.getAttribute('aria-valuetext');
    expect(valueText).toBe('50%');
  });
});
