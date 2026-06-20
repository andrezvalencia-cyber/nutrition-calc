const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Plain-Node test scripts that call process.exit at top level — must
  // be excluded from Playwright auto-discovery or they kill the runner
  // before integration.test.js executes. Run those via `node tests/<file>`.
  testIgnore: ['**/carryover-engine.test.js', '**/sync-leader.test.js', '**/write-behind.test.js', '**/sw-activate.test.js', '**/perf-benchmark.js', '**/sync-map.test.js', '**/insights-engine.test.js', '**/precache-parity.test.js', '**/custom-foods.test.js'],
  timeout: 15000,
  use: {
    baseURL: 'http://localhost:8765',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: '**/visual-consistency.test.js',
    },
  ],
  webServer: {
    command: 'npx serve -p 8765 -s',
    port: 8765,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
