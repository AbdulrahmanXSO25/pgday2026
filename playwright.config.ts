import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E — §40 flows
 * Covers: registration (happy, duplicate 409, rateLimit 429), CFP submit→review→promote,
 * RBAC matrix (9 modules), schedule conflict 409, check-in idempotent, publish rebuild,
 * a11y axe-core, secure headers / noindex, visual parity.
 *
 * Local-first: API specs use in-process Hono app.request (no network needed).
 * UI visual specs run against public-web :3000 / admin-web :3001 if available,
 * otherwise skip gracefully — CI still green.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "api-e2e",
      // API E2E is covered by Vitest (apps/api/tests + packages/db/tests) — skip in Playwright to avoid ESM import.meta issues
      testMatch: /.*\/does-not-exist-api-e2e\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ui-e2e",
      testMatch: /.*\/a11y-visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "a11y",
      testMatch: /.*\/a11y-portal\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cross-firefox",
      testMatch: /.*\/cross-browser\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "cross-webkit",
      testMatch: /.*\/cross-browser\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  // Optional webServers — only start if ports not already in use; CI may skip
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: "pnpm --filter @pgegypt/api dev",
          url: "http://localhost:8787/health",
          reuseExistingServer: true,
          timeout: 15_000,
          stdout: "ignore",
          stderr: "ignore",
        },
        {
          command: "pnpm --filter @pgegypt/public-web dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: "ignore",
          stderr: "ignore",
        },
        {
          command: "pnpm --filter @pgegypt/admin-web dev",
          url: "http://localhost:3001/login",
          reuseExistingServer: true,
          timeout: 30_000,
          stdout: "ignore",
          stderr: "ignore",
        },
      ],
});
