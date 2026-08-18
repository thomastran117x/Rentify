import { expect, test } from "@playwright/test";

test.describe("public header and footer navigation", () => {
  test("header nav links reach their pages", async ({ page }) => {
    const header = page.getByRole("banner");
    const links: Array<[string, RegExp]> = [
      ["Browse", /\/postings$/],
      ["Blog", /\/blog$/],
    ];

    for (const [name, url] of links) {
      await page.goto("/");
      await header.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test("header keeps only useful CTAs, not the retired marketing links", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.getByRole("banner");

    await expect(
      header.getByRole("link", { name: "How it works" }),
    ).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Services" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Contact" })).toHaveCount(0);
  });

  test("header Log in reaches /login, and /login links to /signup", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Log in" })
      .click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("footer nav links reach their pages", async ({ page }) => {
    const footer = page.getByRole("contentinfo");
    const links: Array<[string, RegExp]> = [
      ["Browse rentals", /\/postings$/],
      ["Browse organizations", /\/organizations$/],
      ["How it works", /\/how-it-works$/],
      ["Services", /\/services$/],
      ["About", /\/about$/],
      ["FAQ", /\/faq$/],
      ["Contact", /\/contact$/],
      ["Privacy", /\/privacy$/],
      ["Terms", /\/terms$/],
      ["Accessibility", /\/accessibility$/],
    ];

    for (const [name, url] of links) {
      await page.goto("/");
      await footer.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });
});
