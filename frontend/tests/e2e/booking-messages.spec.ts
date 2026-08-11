import { expect, test, type Page } from "@playwright/test";

const USERNAME = "renter-one";
const OWNER_USERNAME = "owner-one";
const PASSWORD = "Rentify123!";

/** Seeded booking whose renter is `renter-one` and whose org `owner-one` runs. */
const THREAD_PATH = "/bookings/00000000-0000-0000-3000-000000000001";

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

async function login(page: Page, nextPath = "/bookings", username = USERNAME) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(username);
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
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();

    const composer = page.getByLabel("Message");
    const sendButton = page.getByRole("button", { name: /send/i });

    // Validation path: an empty composer cannot be submitted.
    await expect(sendButton).toBeDisabled();

    const body = `Playwright check ${Date.now()}`;
    // Scoped to the thread: the composer still holds the same text until the
    // send resolves, so an unscoped text match is ambiguous.
    const sentMessage = page
      .getByTestId("booking-message")
      .filter({ hasText: body });

    await composer.fill(body);
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(sentMessage).toBeVisible();
    await expect(composer).toHaveValue("");

    // The thread must survive a reload — messages are durably persisted.
    await page.reload();
    await expect(sentMessage).toBeVisible();

    // Folded in rather than given its own test, which would cost another
    // sign-in: the login endpoint allows ten attempts per minute per IP and
    // every spec in this suite draws on that one budget.
    await composer.fill("x".repeat(2001));
    await expect(page.getByText("2001 / 2000")).toBeVisible();
    await expect(sendButton).toBeDisabled();

    expect(consoleErrors).toEqual([]);
  });

  // The one test that signs in twice. Sessions are not shared between the two
  // contexts on purpose: the device id travels in local storage, so a reused
  // storage state presents an already-rotated refresh token and lands back on
  // the login page.
  test("both parties see typing and a new message over the socket", async ({
    browser,
  }) => {
    // Two contexts, because the point of the socket is what one party sees
    // while the other acts. Neither page reloads once the thread is open.
    //
    // Opened directly rather than through the dashboard, because the two
    // accounts have to land on opposite sides of this thread. renter-one is
    // also a manager in owner-one's organization, so on most seeded bookings
    // both sit on the owner side and every frame is correctly filtered as a
    // self-echo. On this booking renter-one is the renter, and renter-first
    // precedence puts them on the renter side.
    const renterContext = await browser.newContext();
    const ownerContext = await browser.newContext();
    const renterPage = await renterContext.newPage();
    const ownerPage = await ownerContext.newPage();
    const renterErrors = collectConsoleErrors(renterPage);

    try {
      // The renter connects first so the owner's arrival produces the presence
      // frame. A client joining second learns presence from the next frame
      // instead, which is a known gap rather than something to assert here.
      await login(renterPage, THREAD_PATH);
      await expect(
        renterPage.getByRole("heading", { name: "Messages" }),
      ).toBeVisible();

      await login(ownerPage, THREAD_PATH, OWNER_USERNAME);
      await expect(
        ownerPage.getByRole("heading", { name: "Messages" }),
      ).toBeVisible();

      // Presence: the renter sees the owner come online without a reload.
      await expect(
        renterPage.getByTestId("counterpart-presence"),
      ).toHaveAttribute("data-online", "true");

      // Typing: a keystroke on one side raises the indicator on the other.
      await ownerPage.getByLabel("Message").fill("Typing");
      await expect(renterPage.getByText(/owner-one is typing/i)).toBeVisible();

      const body = `Socket check ${Date.now()}`;
      await ownerPage.getByLabel("Message").fill(body);
      await ownerPage.getByRole("button", { name: /send/i }).click();

      // The message arrives on a page that never navigated or refetched.
      await expect(
        renterPage.getByTestId("booking-message").filter({ hasText: body }),
      ).toBeVisible();

      expect(renterErrors).toEqual([]);
    } finally {
      await renterContext.close();
      await ownerContext.close();
    }
  });
});
