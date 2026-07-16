import { expect, test, type Page } from "@playwright/test";

const OWNER_USERNAME = "owner-one";
const MANAGER_USERNAME = "renter-one";
const OPERATOR_USERNAME = "renter-two";
const PASSWORD = "Rentify123!";
const ORGANIZATION_NAME = "Maya Santos Organization";
const OWNER_ORG_LABEL = `${ORGANIZATION_NAME} - Primary Manager`;
const MANAGER_ORG_LABEL = `${ORGANIZATION_NAME} - Manager`;
const OPERATOR_ORG_LABEL = `${ORGANIZATION_NAME} - Operator`;

test.describe.configure({ mode: "serial" });

async function ensureCaptchaToken(page: Page) {
  const readCaptchaToken = async () =>
    page.evaluate(() => {
      const rawCaptchaState = window.sessionStorage.getItem(
        "rentify.auth.captcha",
      );

      if (!rawCaptchaState) {
        return "";
      }

      try {
        const parsedCaptchaState = JSON.parse(rawCaptchaState) as {
          token?: string;
        };

        return parsedCaptchaState.token?.trim() ?? "";
      } catch {
        return "";
      }
    });

  const token = await readCaptchaToken();

  if (!token) {
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "rentify.auth.captcha",
        JSON.stringify({
          token: "local-dev-bypass",
          createdAt: Date.now(),
        }),
      );
      window.dispatchEvent(new Event("rentify-auth-captcha-storage"));
    });
  }

  await expect.poll(readCaptchaToken).not.toBe("");
}

async function login(
  page: Page,
  username: string,
  nextPath = "/dashboard/organizations",
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(username);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function ensureActiveOrganization(page: Page, label: string) {
  const organizationSwitcher = page.getByRole("combobox", {
    name: "Active organization",
  });
  await expect(organizationSwitcher).toBeVisible();
  await organizationSwitcher.selectOption({ label });
}

async function expectOrganizationsWorkspace(
  page: Page,
  roleLabel: string,
  expectedUrl: RegExp = /\/dashboard\/organizations(?:\?tab=overview)?$/,
) {
  await expect(page).toHaveURL(expectedUrl);
  await expect(
    page.getByRole("heading", { name: ORGANIZATION_NAME }),
  ).toBeVisible();
  await expect(page.getByText(`Your role: ${roleLabel}`)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Jump to the work that matters")).toBeVisible();
}

test("organization workspace supports owner invites and member role boundaries", async ({
  browser,
  page,
}) => {
  const consoleErrors: string[] = [];
  const ownerInviteEmail = `org-owner-${Date.now()}@rentify.local`;
  const managerInviteEmail = `org-manager-${Date.now()}@rentify.local`;

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await login(page, OWNER_USERNAME);
  await ensureActiveOrganization(page, OWNER_ORG_LABEL);
  await expectOrganizationsWorkspace(page, "Primary Manager");

  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByText("Invite teammates")).toBeVisible();
  await page.getByPlaceholder("teammate@example.com").fill(ownerInviteEmail);
  await page
    .getByRole("combobox", { name: "Invite role" })
    .selectOption("manager");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  const managerPage = await browser.newPage();
  await login(managerPage, MANAGER_USERNAME);
  await ensureActiveOrganization(managerPage, MANAGER_ORG_LABEL);
  await expectOrganizationsWorkspace(managerPage, "Manager");
  await expect(managerPage.getByRole("tab", { name: "Settings" })).toHaveCount(
    0,
  );
  await expect(managerPage.getByRole("tab", { name: "Activity" })).toHaveCount(
    1,
  );

  await managerPage.getByRole("tab", { name: "Team" }).click();
  await managerPage
    .getByPlaceholder("teammate@example.com")
    .fill(managerInviteEmail);
  await managerPage.getByRole("button", { name: "Send invite" }).click();
  await expect(managerPage.getByText("Invitation sent.")).toBeVisible();

  const operatorPage = await browser.newPage();
  await login(operatorPage, OPERATOR_USERNAME);
  await ensureActiveOrganization(operatorPage, OPERATOR_ORG_LABEL);
  await expectOrganizationsWorkspace(operatorPage, "Operator");
  await expect(operatorPage.getByRole("tab", { name: "Activity" })).toHaveCount(
    0,
  );
  await expect(operatorPage.getByRole("tab", { name: "Settings" })).toHaveCount(
    0,
  );

  await operatorPage.getByRole("tab", { name: "Team" }).click();
  await expect(
    operatorPage
      .getByText(
        "Operators can review pending invitations here, but only managers can send them.",
      )
      .first(),
  ).toBeVisible();
  await expect(
    operatorPage.getByRole("button", { name: "Send invite" }),
  ).toHaveCount(0);

  await operatorPage.goto("/dashboard/organizations?tab=activity");
  await expectOrganizationsWorkspace(
    operatorPage,
    "Operator",
    /\/dashboard\/organizations\?tab=overview$/,
  );

  await operatorPage.goto("/dashboard/organizations?tab=settings");
  await expectOrganizationsWorkspace(
    operatorPage,
    "Operator",
    /\/dashboard\/organizations\?tab=overview$/,
  );

  expect(consoleErrors).toEqual([]);

  await Promise.all([managerPage.close(), operatorPage.close()]);
});


