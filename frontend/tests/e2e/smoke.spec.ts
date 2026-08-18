import { expect, test } from "@playwright/test";

test("homepage renders without backend auth dependencies", async ({ page }) => {
  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      }),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Find the right rental without the clutter.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Rentify" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Browse" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Blog" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("What are you looking for?"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Log in" }).first(),
  ).toBeVisible();
});
