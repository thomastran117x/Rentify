import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

function accountMenuTrigger(page: Page) {
  // The trigger is a native <summary aria-label="... account menu"> inside a
  // <details> disclosure. Chromium exposes <summary> with an internal
  // "DisclosureTriangle" accessibility role rather than "button", so
  // getByRole("button", ...) never matches it — target the element directly.
  return page.locator('summary[aria-label$="account menu"]');
}

function accountMenu(page: Page) {
  return page.locator('details:has(summary[aria-label$="account menu"])');
}

async function openAccountMenu(page: Page) {
  await accountMenuTrigger(page).click();
}

test.describe("account menu", () => {
  // Exercised on "/" — a public route with no app-shell sidebar — so these
  // assertions cannot accidentally match a sidebar link.
  test("carries identity actions only", async ({ ownerPage: page }) => {
    await page.goto("/");
    await openAccountMenu(page);

    const menu = accountMenu(page);
    await expect(menu.getByText("owner1@rentify.local")).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Manage account", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Organizations", exact: true }),
    ).toBeVisible();
    await expect(menu.getByText("Theme")).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "Log out", exact: true }),
    ).toBeVisible();

    // Everything role-gated now lives in the sidebar.
    for (const label of [
      "Dashboard",
      "Postings",
      "Create posting",
      "Moderation",
      "Saved",
      "Bookings",
    ]) {
      await expect(menu.getByRole("link", { name: label })).toHaveCount(0);
    }
  });

  test("both links navigate", async ({ ownerPage: page }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await accountMenu(page)
      .getByRole("link", { name: "Manage account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/account$/);

    await page.goto("/");
    await openAccountMenu(page);
    await accountMenu(page)
      .getByRole("link", { name: "Organizations", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/organizations/);
  });

  test("closes on Escape and on a click outside", async ({
    ownerPage: page,
  }) => {
    await page.goto("/");

    await openAccountMenu(page);
    await expect(accountMenuTrigger(page)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(accountMenuTrigger(page)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await openAccountMenu(page);
    await expect(accountMenuTrigger(page)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.getByRole("banner").click({ position: { x: 5, y: 5 } });
    await expect(accountMenuTrigger(page)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("shows a log in link instead for anonymous visitors", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(accountMenuTrigger(page)).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Log in" }),
    ).toBeVisible();
  });
});
