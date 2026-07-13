import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

const OWNER_USERNAME = "owner-one";
const MANAGER_USERNAME = "renter-seven";
const MANAGER_EMAIL = "user7@rentify.local";
const OPERATOR_USERNAME = "renter-eight";
const OPERATOR_EMAIL = "user8@rentify.local";
const PASSWORD = "Rentify123!";
const EMAIL_QUEUE_NAMES = [
  "email.delivery.main",
  "email.delivery.retry.1",
  "email.delivery.retry.2",
  "email.delivery.retry.3",
  "email.delivery.dead-letter",
];

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
  nextPath = "/organizations",
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(username);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectOrganizationsWorkspace(page: Page, roleLabel: string) {
  await expect(
    page.getByRole("heading", {
      name: "Manage teammates before shared posting access rolls out",
    }),
  ).toBeVisible();
  await expect(page.getByText(`Your role: ${roleLabel}`)).toBeVisible();
}

async function readOrganizationInviteMessages(queueName: string) {
  const output = execFileSync(
    "docker",
    [
      "exec",
      "rent-rabbitmq",
      "sh",
      "-lc",
      `rabbitmqadmin --format=raw_json --username=guest --password=guest get queue=${queueName} count=100 ackmode=ack_requeue_true encoding=auto`,
    ],
    {
      encoding: "utf8",
    },
  );

  const payload = JSON.parse(output) as Array<{
    payload?: string;
  }>;

  return payload
    .map((message) => {
      try {
        return message.payload ? JSON.parse(message.payload) : null;
      } catch {
        return null;
      }
    })
    .filter(
      (
        message,
      ): message is {
        kind: string;
        occurredAt: string;
        input: { email?: string; to?: string; token?: string };
      } => Boolean(message && typeof message === "object"),
    );
}

async function waitForInviteToken(email: string): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20000) {
    const messages = (
      await Promise.all(
        EMAIL_QUEUE_NAMES.map((queueName) =>
          readOrganizationInviteMessages(queueName),
        ),
      )
    )
      .flat()
      .filter(
        (message) =>
          message.kind === "organization_invite" &&
          (message.input.to === email || message.input.email === email) &&
          typeof message.input.token === "string",
      )
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

    const token = messages[0]?.input.token;

    if (token) {
      return token;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Invite token not found for ${email}.`);
}

async function openInviteAndLogin(
  browser: Browser,
  token: string,
  username: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/organizations/invitations/${token}`);
  await expect(page.getByRole("heading", { name: /Join .+/ })).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await login(page, username, `/organizations/invitations/${token}`);

  return { context, page };
}

test("organization workspace supports owner invites and member role boundaries", async ({
  browser,
  page,
}) => {
  const consoleErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await login(page, OWNER_USERNAME);
  await expectOrganizationsWorkspace(page, "Primary Manager");

  await page.getByPlaceholder("teammate@example.com").fill(MANAGER_EMAIL);
  await page.getByRole("combobox").nth(1).selectOption("manager");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  const managerToken = await waitForInviteToken(MANAGER_EMAIL);

  await page.getByPlaceholder("teammate@example.com").fill(OPERATOR_EMAIL);
  await page.getByRole("combobox").nth(1).selectOption("operator");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  const operatorToken = await waitForInviteToken(OPERATOR_EMAIL);

  const { context: managerContext, page: managerPage } =
    await openInviteAndLogin(browser, managerToken, MANAGER_USERNAME);

  await expect(
    managerPage.getByRole("button", { name: "Accept invitation" }),
  ).toBeEnabled();
  await managerPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(managerPage).toHaveURL(/\/organizations$/);
  await expectOrganizationsWorkspace(managerPage, "Manager");
  await expect(
    managerPage.getByRole("button", { name: "Save name" }),
  ).toHaveCount(0);

  await managerPage
    .getByPlaceholder("teammate@example.com")
    .fill("user6@rentify.local");
  await managerPage.getByRole("button", { name: "Send invite" }).click();
  await expect(managerPage.getByText("Invitation sent.")).toBeVisible();

  const mismatchContext = await browser.newContext();
  const mismatchPage = await mismatchContext.newPage();
  await login(
    mismatchPage,
    MANAGER_USERNAME,
    `/organizations/invitations/${operatorToken}`,
  );
  await expect(
    mismatchPage.getByText(
      "This invite was sent to a different email address. Sign in with the invited email to continue.",
    ),
  ).toBeVisible();
  await expect(
    mismatchPage.getByRole("button", { name: "Accept invitation" }),
  ).toBeDisabled();

  const { context: operatorContext, page: operatorPage } =
    await openInviteAndLogin(browser, operatorToken, OPERATOR_USERNAME);

  await expect(
    operatorPage.getByRole("button", { name: "Accept invitation" }),
  ).toBeEnabled();
  await operatorPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(operatorPage).toHaveURL(/\/organizations$/);
  await expectOrganizationsWorkspace(operatorPage, "Operator");
  await expect(
    operatorPage.getByText(
      "Operators can review pending invitations here, but only managers can send them.",
    ),
  ).toBeVisible();
  await expect(
    operatorPage.getByRole("button", { name: "Send invite" }),
  ).toHaveCount(0);

  expect(consoleErrors).toEqual([]);

  await Promise.all([
    managerContext.close(),
    mismatchContext.close(),
    operatorContext.close(),
  ]);
});
