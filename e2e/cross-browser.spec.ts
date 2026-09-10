/**
 * cross-browser.spec.ts — portal + admin smoke on Firefox/WebKit (§1.5).
 * Runs the real flows (register, CFP wizard, admin login) on non-Chromium engines.
 */
import { test, expect } from "@playwright/test";

test.describe("Portal smoke (cross-browser)", () => {
  test("home renders with header/footer", async ({ page }) => {
    await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("registration form submits against the API", async ({ page }) => {
    const email = `xb.${Date.now()}@example.com`;
    await page.goto("http://localhost:3000/register", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Full name").fill("Cross Browser");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /register to attend/i }).click();
    await expect(page.getByText(/you're registered/i)).toBeVisible({ timeout: 15_000 });
  });

  test("CFP wizard completes all three steps", async ({ page }) => {
    await page.goto("http://localhost:3000/cfp", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    await page.getByLabel(/talk title/i).fill("Cross-browser wizard check");
    await page
      .getByLabel(/abstract/i)
      .fill(
        "Submitting from a non-Chromium engine to verify the CFP wizard works identically across browsers."
      );
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/full name/i).fill("Cross Browser");
    await page.getByLabel(/email/i).fill(`xb.cfp.${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /submit proposal/i }).click();
    await expect(page.getByText(/submission received/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Admin smoke (cross-browser)", () => {
  test("login and dashboard render", async ({ page }) => {
    await page.goto("http://localhost:3001/login", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "email" }).fill("superadmin@pgegypt.test");
    await page.getByRole("textbox", { name: "password" }).fill("SuperAdmin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
