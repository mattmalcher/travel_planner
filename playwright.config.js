import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8345',
    trace: 'on-first-retry',
    // The page registers a service worker (issue #45). Once one controls a
    // page, page.route can no longer intercept its fetches, which would
    // break the esm.sh/OpenRouter stubs on specs that reload. Block it by
    // default (also exercising the registration no-op path);
    // offline.spec.js opts back in with test.use.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx http-server dist -p 8345',
    url: 'http://127.0.0.1:8345/holiday_itinerary_viewer.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
