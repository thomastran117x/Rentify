import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

function accountMenuTrigger(page: Page) {
  // The trigger is a native <summary aria-label="... account menu"> inside a
  // <details> disclosure. Chromium exposes <summary> with an internal
  // "DisclosureTriangle" accessibility role rather than "button", so
  // getByRole("button", ...) never matches it — target the element directly.
  return page.locator('summary[aria-label$="account menu"]');
}

async function openAccountMenu(page: Page) {
  await accountMenuTrigger(page).click();
}

interface ExpectedLinks {
  dashboard: boolean;
  postings: boolean;
  createPosting: boolean;
  moderation: boolean;
}

async function expectConditionalLinks(page: Page, expected: ExpectedLinks) {
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(
    expected.dashboard ? 1 : 0,
  );
  await expect(page.getByRole("link", { name: /^Postings\b/ })).toHaveCount(
    expected.postings ? 1 : 0,
  );
  await expect(page.getByRole("link", { name: "Create posting" })).toHaveCount(
    expected.createPosting ? 1 : 0,
  );
  await expect(page.getByRole("link", { name: "Moderation" })).toHaveCount(
    expected.moderation ? 1 : 0,
  );
}

test.describe("account menu navigation and role-conditional visibility", () => {
  test("owner sees Dashboard, Postings, and Create posting, but not Moderation", async ({
    ownerPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expectConditionalLinks(page, {
      dashboard: true,
      postings: true,
      createPosting: true,
      moderation: false,
    });

    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", {
        name: "Watch your listing funnel move in real time",
      }),
    ).toBeVisible();

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: /^Postings\b/ }).click();
    await expect(page).toHaveURL(/\/postings\/manage$/);

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: "Create posting" }).click();
    await expect(page).toHaveURL(/\/postings\/create$/);
  });

  test("admin sees Dashboard (restricted analytics), Create posting, and Moderation, but not Postings", async ({
    adminPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expectConditionalLinks(page, {
      dashboard: true,
      postings: false,
      createPosting: true,
      moderation: true,
    });

    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", {
        name: "Owner analytics unlock when you start hosting",
      }),
    ).toBeVisible();

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: "Moderation" }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(
      page.getByRole("heading", { name: "Report queue" }),
    ).toBeVisible();
  });

  test("manager sees Postings and Create posting, but not Dashboard or Moderation", async ({
    managerPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expectConditionalLinks(page, {
      dashboard: false,
      postings: true,
      createPosting: true,
      moderation: false,
    });

    await page.getByRole("link", { name: /^Postings\b/ }).click();
    await expect(page).toHaveURL(/\/postings\/manage$/);

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: "Create posting" }).click();
    await expect(page).toHaveURL(/\/postings\/create$/);
  });

  test("operator sees Postings, but not Dashboard, Create posting, or Moderation", async ({
    operatorPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expectConditionalLinks(page, {
      dashboard: false,
      postings: true,
      createPosting: false,
      moderation: false,
    });

    await page.getByRole("link", { name: /^Postings\b/ }).click();
    await expect(page).toHaveURL(/\/postings\/manage$/);
  });

  test("viewer with no organization sees none of the conditional links", async ({
    viewerPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expectConditionalLinks(page, {
      dashboard: false,
      postings: false,
      createPosting: false,
      moderation: false,
    });
  });

  test("moderator sees only Moderation among the conditional links", async ({
    modPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expectConditionalLinks(page, {
      dashboard: false,
      postings: false,
      createPosting: false,
      moderation: true,
    });

    await page.getByRole("link", { name: "Moderation" }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(
      page.getByRole("heading", { name: "Report queue" }),
    ).toBeVisible();
  });

  test("role-independent links reach Organizations, Saved postings, Bookings, and Manage account", async ({
    ownerPage: page,
  }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: "Organizations" }).click();
    await expect(page).toHaveURL(/\/dashboard\/organizations/);

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: "Saved postings" }).click();
    await expect(page).toHaveURL(/\/saved$/);

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: /^Bookings\b/ }).click();
    await expect(page).toHaveURL(/\/bookings$/);

    await page.goto("/");
    await openAccountMenu(page);
    await page.getByRole("link", { name: "Manage account" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
