/**
 * a11y-portal.spec.ts — axe-core audit (Playwright browser, §29/§35.4)
 * Runs against a live public-web (:3000) and admin-web (:3001).
 * Fails on serious/critical violations.
 *
 * Requires: servers running (playwright webServer config handles it) + chromium.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PORTAL_ROUTES = [
  "/",
  "/about",
  "/schedule",
  "/speakers",
  "/speakers/karim-el-sayed",
  "/cfp",
  "/venue",
  "/sponsors",
  "/register",
  "/code-of-conduct",
  "/organizers",
  "/faq",
  "/contact",
];

const ADMIN_ROUTES = [
  "/",
  "/speakers",
  "/sessions",
  "/schedule",
  "/sponsors",
  "/registrations",
  "/cfp",
  "/media",
  "/check-in",
  "/users",
  "/settings",
  "/audit-log",
];

async function assertNoSeriousViolations(page: import("@playwright/test").Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad
    .map((v) => `${v.id}(${v.impact}): ${v.nodes.length} nodes — ${v.help}`)
    .join("\n");
  expect(bad, `a11y violations on ${label}:\n${summary}`).toEqual([]);
}

test.describe("Portal accessibility (axe-core)", () => {
  for (const route of PORTAL_ROUTES) {
    test(`portal ${route} has no serious/critical violations`, async ({ page }) => {
      await page.goto(`http://localhost:3000${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(400);
      await assertNoSeriousViolations(page, `portal ${route}`);
    });
  }
});

test.describe("Admin accessibility (axe-core)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3001/login", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByRole("textbox", { name: "email" }).fill("superadmin@pgegypt.test");
    await page.getByRole("textbox", { name: "password" }).fill("SuperAdmin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(1200);
  });

  for (const route of ADMIN_ROUTES) {
    test(`admin ${route} has no serious/critical violations`, async ({ page }) => {
      await page.goto(`http://localhost:3001${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(500);
      await assertNoSeriousViolations(page, `admin ${route}`);
    });
  }
});
