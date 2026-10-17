import { test, expect } from "@playwright/test";

test("login screen renders with the PIN pad", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /MegaDine/i })).toBeVisible();
  await expect(page.getByText(/Offline-first restaurant POS/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeDisabled();
});

test("PIN pad accepts digits and enables Enter at 4 digits", async ({ page }) => {
  await page.goto("/");
  for (const d of ["1", "2", "3", "4"]) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeEnabled();
});

test("clear and backspace work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "⌫" }).click();
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "C", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enter", exact: true })).toBeDisabled();
});

test("can switch to email sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /email instead/i }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeVisible();
});

test("PWA manifest is linked", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});
