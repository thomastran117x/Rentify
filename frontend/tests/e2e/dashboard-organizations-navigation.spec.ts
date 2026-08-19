import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

const ORGANIZATION_NAME = "Harbor Loft Rentals";

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

async function goToOverview(page: Page) {
  await page.goto("/dashboard/organizations/overview");
}

test.describe("dashboard organizations sidebar navigation", () => {
  test("owner (primary manager) can reach every workspace section via the sidebar", async ({
    ownerPage: page,
  }) => {
    await goToOverview(page);
    await ensureActiveOrganization(
      page,
      `${ORGANIZATION_NAME} - Primary Manager`,
    );

    const sections: Array<[RegExp, RegExp]> = [
      [/Overview/, /\/dashboard\/organizations\/overview$/],
      [/Team/, /\/dashboard\/organizations\/team$/],
      [/Content/, /\/dashboard\/organizations\/content$/],
      [/Postings/, /\/dashboard\/organizations\/postings$/],
      [/Activity/, /\/dashboard\/organizations\/activity$/],
      [/Settings/, /\/dashboard\/organizations\/settings$/],
    ];

    for (const [name, url] of sections) {
      await sidebarLink(page, name).click();
      await expect(page).toHaveURL(url);
      await expect(sidebarLink(page, name)).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("manager can reach Overview/Team/Content/Postings/Activity but not Settings", async ({
    managerPage: page,
  }) => {
    await goToOverview(page);
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Manager`);

    const sections: Array<[RegExp, RegExp]> = [
      [/Overview/, /\/dashboard\/organizations\/overview$/],
      [/Team/, /\/dashboard\/organizations\/team$/],
      [/Content/, /\/dashboard\/organizations\/content$/],
      [/Postings/, /\/dashboard\/organizations\/postings$/],
      [/Activity/, /\/dashboard\/organizations\/activity$/],
    ];

    for (const [name, url] of sections) {
      await sidebarLink(page, name).click();
      await expect(page).toHaveURL(url);
    }

    await expect(sidebarLink(page, /Settings/)).toHaveCount(0);
  });

  test("operator can reach Overview/Team/Content/Postings but not Activity or Settings", async ({
    operatorPage: page,
  }) => {
    await goToOverview(page);
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Operator`);

    const sections: Array<[RegExp, RegExp]> = [
      [/Overview/, /\/dashboard\/organizations\/overview$/],
      [/Team/, /\/dashboard\/organizations\/team$/],
      [/Content/, /\/dashboard\/organizations\/content$/],
      [/Postings/, /\/dashboard\/organizations\/postings$/],
    ];

    for (const [name, url] of sections) {
      await sidebarLink(page, name).click();
      await expect(page).toHaveURL(url);
    }

    await expect(sidebarLink(page, /Activity/)).toHaveCount(0);
    await expect(sidebarLink(page, /Settings/)).toHaveCount(0);
  });
});

test.describe("dashboard organizations overview quick-action cards", () => {
  test("owner can reach Team/Postings/Activity/Settings via quick-action buttons", async ({
    ownerPage: page,
  }) => {
    await goToOverview(page);
    await ensureActiveOrganization(
      page,
      `${ORGANIZATION_NAME} - Primary Manager`,
    );

    const actions: Array<[RegExp, RegExp]> = [
      [/Manage teammates and invites/, /\/dashboard\/organizations\/team$/],
      [/Check listing readiness/, /\/dashboard\/organizations\/postings$/],
      [/Review recent changes/, /\/dashboard\/organizations\/activity$/],
      [/Refresh organization details/, /\/dashboard\/organizations\/settings$/],
    ];

    for (const [name, url] of actions) {
      await goToOverview(page);
      await page.getByRole("button", { name }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test("manager sees Team/Postings/Activity quick actions but not Settings", async ({
    managerPage: page,
  }) => {
    await goToOverview(page);
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Manager`);

    const actions: Array<[RegExp, RegExp]> = [
      [/Manage teammates and invites/, /\/dashboard\/organizations\/team$/],
      [/Check listing readiness/, /\/dashboard\/organizations\/postings$/],
      [/Review recent changes/, /\/dashboard\/organizations\/activity$/],
    ];

    for (const [name, url] of actions) {
      await goToOverview(page);
      await page.getByRole("button", { name }).click();
      await expect(page).toHaveURL(url);
    }

    await goToOverview(page);
    await expect(
      page.getByRole("button", { name: /Refresh organization details/ }),
    ).toHaveCount(0);
  });

  test("operator sees read-only Team/Postings quick actions but no Activity or Settings actions", async ({
    operatorPage: page,
  }) => {
    await goToOverview(page);
    await ensureActiveOrganization(page, `${ORGANIZATION_NAME} - Operator`);

    await expect(
      page.getByRole("button", { name: /Review teammates and invites/ }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Manage teammates and invites/ }),
    ).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: /Review recent changes/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Refresh organization details/ }),
    ).toHaveCount(0);
  });
});
