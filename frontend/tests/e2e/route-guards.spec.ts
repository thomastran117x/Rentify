import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

const ORGANIZATION_NAME = "Maya Santos Organization";

function sidebarLink(page: Page, name: RegExp) {
  return page
    .getByRole("navigation", { name: "Organization workspace sections" })
    .getByRole("link", { name });
}

async function ensureActiveOrganization(page: Page, label: string) {
  const organizationSwitcher = page.getByRole("combobox", {
    name: "Active organization",
  });
  await expect(organizationSwitcher).toBeVisible();
  await organizationSwitcher.selectOption({ label });
}

test.describe("anonymous route guards", () => {
  test("visiting /dashboard while anonymous redirects to /login with no next param", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    expect(new URL(page.url()).search).toBe("");
  });

  test("visiting /dashboard/organizations while anonymous redirects to /login?next=/dashboard/organizations", async ({
    page,
  }) => {
    await page.goto("/dashboard/organizations");
    await expect(page).toHaveURL(/\/login\?next=\/dashboard\/organizations$/);
  });

  test("visiting /moderation while anonymous redirects to /login?next=%2Fmoderation", async ({
    page,
  }) => {
    await page.goto("/moderation");
    await expect(page).toHaveURL(/\/login\?next=%2Fmoderation$/);
  });
});

test.describe("organization-role route guards", () => {
  test("a manager cannot open Settings directly and falls back to overview", async ({
    managerPage: page,
  }) => {
    await page.goto("/dashboard/organizations/overview");
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Manager`);

    await page.goto("/dashboard/organizations/settings");
    await expect(page).toHaveURL(/\/dashboard\/organizations\/overview$/);
    await expect(sidebarLink(page, /Settings/)).toHaveCount(0);
  });
});

test.describe("site-role route guards for /moderation", () => {
  test("a non-moderator authenticated user sees an inline forbidden message, not a redirect", async ({
    viewerPage: page,
  }) => {
    await page.goto("/moderation");
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(
      page.getByText("Moderation access is limited to moderators and admins."),
    ).toBeVisible();
  });

  test("a moderator sees the real moderation workspace", async ({
    modPage: page,
  }) => {
    await page.goto("/moderation");
    await expect(
      page.getByRole("heading", { name: "Report queue" }),
    ).toBeVisible();
  });

  test("an admin sees the real moderation workspace", async ({
    adminPage: page,
  }) => {
    await page.goto("/moderation");
    await expect(
      page.getByRole("heading", { name: "Report queue" }),
    ).toBeVisible();
  });
});
