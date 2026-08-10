import { expect, test, type Page } from "@playwright/test";

const USERNAME = "renter-one";
const PASSWORD = "Rentify123!";

test.describe.configure({ mode: "serial" });

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  return errors;
}

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

  if (!(await readCaptchaToken())) {
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

async function login(page: Page, nextPath = "/bookings") {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(USERNAME);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("booking messages", () => {
  test("anonymous visitors are sent to login from a booking detail page", async ({
    page,
  }) => {
    await page.goto("/bookings/00000000-0000-0000-3000-000000000001");

    await expect(page).toHaveURL(/\/login/);
  });

  // A single sign-in covers every authenticated assertion: the login endpoint
  // is rate limited and this suite shares that budget with the other specs.
  test("a renter can open a thread from the dashboard and send a message", async ({
    page,
  }) => {
    await login(page);
    const consoleErrors = collectConsoleErrors(page);

    const messagesLink = page.getByRole("link", { name: "Messages" }).first();
    await expect(messagesLink).toBeVisible();
    await messagesLink.click();

    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/i);
    await expect(
      page.getByRole("heading", { name: "Messages" }),
    ).toBeVisible();

    const composer = page.getByLabel("Message");
    const sendButton = page.getByRole("button", { name: /send/i });

    // Validation path: an empty composer cannot be submitted.
    await expect(sendButton).toBeDisabled();

    const body = `Playwright check ${Date.now()}`;
    await composer.fill(body);
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText(body)).toBeVisible();
    await expect(composer).toHaveValue("");

    // The thread must survive a reload — messages are durably persisted.
    await page.reload();
    await expect(page.getByText(body)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("the composer rejects a body over the maximum length", async ({
    page,
  }) => {
    await login(page);

    await page.getByRole("link", { name: "Messages" }).first().click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/i);

    await page.getByLabel("Message").fill("x".repeat(2001));

    await expect(page.getByText("2001 / 2000")).toBeVisible();
    await expect(page.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
