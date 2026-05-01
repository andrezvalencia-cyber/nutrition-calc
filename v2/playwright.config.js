const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Plain-Node test scripts that call process.exit at top level — must
  // be excluded from Playwright auto-discovery or they kill the runner
  // before integration.test.js executes. Run those via `node tests/<file>`.
  testIgnore: ['**/carryover-engine.test.js', '**/sync-leader.test.js', '**/write-behind.test.js', '**/sw-activate.test.js', '**/perf-benchmark.js'],
  timeout: 15000,
  use: {
    baseURL: 'http://localhost:8765',
    headless: true,
  },
  webServer: {
    command: 'python3 -m http.server 8765',
    port: 8765,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
