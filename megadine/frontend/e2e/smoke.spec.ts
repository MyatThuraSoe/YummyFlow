import { test, expect } from "@playwright/test";

test("login screen renders with the password tab", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
  await expect(page.getByLabel(/Username or email/i)).toBeVisible();
  await expect(page.getByLabel(/^Password$/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeDisabled();
});

test("sign-in button enables after filling credentials", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/Username or email/i).fill("owner");
  await page.getByLabel(/^Password$/i).fill("owner123");
  await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeEnabled();
});

test("PIN tab reveals the numeric input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "PIN" }).click();
  const pin = page.locator('input[inputmode="numeric"]');
  await expect(pin).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeDisabled();
  await pin.fill("1234");
  await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeEnabled();
});

test("PWA manifest is linked", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});
