import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
import { ensureActiveOrganization } from "./helpers/organizations";

const ORGANIZATION_NAME = "Harbor Loft Rentals";

function workspaceNav(page: Page) {
  return page.getByRole("navigation", { name: "Workspace" });
}

function navLink(page: Page, name: string) {
  return workspaceNav(page).getByRole("link", { name, exact: true });
}

interface ExpectedItems {
  dashboard: boolean;
  postings: boolean;
  createPosting: boolean;
  moderation: boolean;
}

async function expectSidebarItems(page: Page, expected: ExpectedItems) {
  await expect(navLink(page, "Dashboard")).toHaveCount(
    expected.dashboard ? 1 : 0,
  );
  await expect(navLink(page, "Postings")).toHaveCount(
    expected.postings ? 1 : 0,
  );
  await expect(navLink(page, "Create posting")).toHaveCount(
    expected.createPosting ? 1 : 0,
  );
  await expect(navLink(page, "Moderation")).toHaveCount(
    expected.moderation ? 1 : 0,
  );

  // Every authenticated role reaches these.
  for (const label of [
    "Bookings",
    "Saved",
    "Saved searches",
    "Organizations",
    "Manage account",
  ]) {
    await expect(navLink(page, label)).toHaveCount(1);
  }
}

test.describe("workspace sidebar navigation", () => {
  test("owner sees Dashboard, Postings, and Create posting, but not Moderation", async ({
    ownerPage: page,
  }) => {
    await page.goto("/account");
    await expectSidebarItems(page, {
      dashboard: true,
      postings: true,
      createPosting: true,
      moderation: false,
    });
  });

  test("admin sees Dashboard, Create posting, and Moderation, but not Postings", async ({
    adminPage: page,
  }) => {
    await page.goto("/account");
    await expectSidebarItems(page, {
      dashboard: true,
      postings: false,
      createPosting: true,
      moderation: true,
    });
  });

  test("manager sees Postings and Create posting, but not Dashboard or Moderation", async ({
    managerPage: page,
  }) => {
    // Org-gated items read the active organization, which the organizations
    // spec may have switched; pin it explicitly.
    await page.goto("/dashboard/organizations/overview");
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Manager`);

    await page.goto("/account");
    await expectSidebarItems(page, {
      dashboard: false,
      postings: true,
      createPosting: true,
      moderation: false,
    });
  });

  test("operator sees Postings, but not Dashboard, Create posting, or Moderation", async ({
    operatorPage: page,
  }) => {
    await page.goto("/dashboard/organizations/overview");
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Operator`);

    await page.goto("/account");
    await expectSidebarItems(page, {
      dashboard: false,
      postings: true,
      createPosting: false,
      moderation: false,
    });
  });

  test("viewer with no organization sees none of the gated items", async ({
    viewerPage: page,
  }) => {
    await page.goto("/account");
    await expectSidebarItems(page, {
      dashboard: false,
      postings: false,
      createPosting: false,
      moderation: false,
    });
  });

  test("moderator sees only Moderation among the gated items", async ({
    modPage: page,
  }) => {
    await page.goto("/account");
    await expectSidebarItems(page, {
      dashboard: false,
      postings: false,
      createPosting: false,
      moderation: true,
    });
  });

  test("each item navigates and marks itself as the current page", async ({
    ownerPage: page,
  }) => {
    const destinations: [string, RegExp][] = [
      ["Dashboard", /\/dashboard$/],
      ["Create posting", /\/postings\/create$/],
      ["Bookings", /\/bookings$/],
      ["Saved", /\/saved$/],
      ["Saved searches", /\/saved\/searches$/],
      ["Manage account", /\/account$/],
    ];

    await page.goto("/account");

    for (const [label, url] of destinations) {
      await navLink(page, label).click();
      await expect(page).toHaveURL(url);
      await expect(navLink(page, label)).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("nests the organization sections under Organizations", async ({
    ownerPage: page,
  }) => {
    await page.goto("/dashboard/organizations/team");

    const sections = workspaceNav(page).getByRole("navigation", {
      name: "Organization workspace sections",
    });
    await expect(sections).toBeVisible();
    await expect(sections.getByRole("link", { name: "Team" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The leaf owns aria-current, not the parent.
    await expect(navLink(page, "Organizations")).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("stays off public marketplace routes", async ({ ownerPage: page }) => {
    await page.goto("/");
    await expect(workspaceNav(page)).toHaveCount(0);

    await page.goto("/postings");
    await expect(workspaceNav(page)).toHaveCount(0);
  });
});
