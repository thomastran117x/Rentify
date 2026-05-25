import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
});

test("marketing pages render and remain navigable", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Find the right rental without the clutter.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "How it works" }).first(),
  ).toBeVisible();

  await page.goto("/how-it-works");
  await expect(
    page.getByRole("heading", {
      name: "Rentify is built to help renters discover faster and owners present listings more clearly.",
    }),
  ).toBeVisible();

  await page.goto("/faq");
  await expect(
    page.getByRole("heading", {
      name: "Common questions, answered without the runaround.",
    }),
  ).toBeVisible();

  await page.goto("/accessibility");
  await expect(
    page.getByRole("heading", {
      name: "Rentify should be usable by more people, on more devices, with fewer barriers.",
    }),
  ).toBeVisible();

  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", {
      name: "Our privacy policy is written to explain what Rentify collects and why.",
    }),
  ).toBeVisible();

  await page.goto("/terms");
  await expect(
    page.getByRole("heading", {
      name: "These terms set expectations for using Rentify and interacting with listings on the marketplace.",
    }),
  ).toBeVisible();
});

test("contact form shows validation and local success state", async ({
  page,
}) => {
  await page.goto("/contact");

  await page.getByRole("button", { name: "Send inquiry" }).click();

  await expect(page.getByText("Please enter your name.")).toBeVisible();
  await expect(
    page.getByText("Please enter your email address."),
  ).toBeVisible();
  await expect(
    page.getByText("Please share a few project details."),
  ).toBeVisible();

  await page.getByRole("textbox", { name: /^Name/ }).fill("Taylor Morgan");
  await page
    .getByRole("textbox", { name: /^Email/ })
    .fill("taylor@example.com");
  await page
    .getByRole("textbox", { name: /^Company or portfolio/ })
    .fill("Northline Rentals");
  await page
    .getByRole("combobox", { name: /^Focus area/ })
    .selectOption("Listing as an owner");
  await page
    .getByRole("textbox", { name: /^Project notes/ })
    .fill("We want help understanding the owner experience and support pages.");

  await page.getByRole("button", { name: "Send inquiry" }).click();

  await expect(
    page.getByText(
      "Thanks. Your inquiry has been captured locally and is ready for backend integration next.",
    ),
  ).toBeVisible();
});
