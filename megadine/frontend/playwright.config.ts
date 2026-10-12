import { defineConfig, devices } from "@playwright/test";

/**
 * UI smoke tests for the MegaDine PWA. These boot the production build via
 * `vite preview` and assert the app shell / login screen render. No backend is
 * required for these checks; run the full API gate with `npm run verify` in the
 * backend package.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
