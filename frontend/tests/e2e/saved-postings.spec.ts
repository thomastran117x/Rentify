import { expect, test, type Page } from "@playwright/test";

const SEARCH_URL = "/postings?q=Gastown%20Production%20Loft";
const POSTING_NAME = "Gastown Production Loft";
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

async function login(page: Page, nextPath = "/postings") {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(USERNAME);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("saved postings", () => {
  test("anonymous visitors are sent to login when they save a posting", async ({
    page,
  }) => {
    await page.goto(SEARCH_URL);
    await expect(
      page.getByRole("heading", { name: POSTING_NAME }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: `Save ${POSTING_NAME}` })
      .first()
      .click();

    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("the saved postings page invites anonymous visitors to log in", async ({
    page,
  }) => {
    await page.goto("/saved");

    await expect(
      page.getByText("Sign in to see your saved postings"),
    ).toBeVisible();
    // Scoped to main: the header carries its own "Log in" link.
    await expect(
      page.getByRole("main").getByRole("link", { name: "Log in" }),
    ).toHaveAttribute("href", "/login?next=/saved");
  });

  // A single sign-in covers every authenticated assertion: the login endpoint
  // is rate limited, and this suite shares that budget with the other specs.
  test("an authenticated renter can save, browse, and unsave postings", async ({
    page,
  }) => {
    const savedIdsRequests: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/postings/saved/ids")) {
        savedIdsRequests.push(request.url());
      }
    });

    await login(page);
    const consoleErrors = collectConsoleErrors(page);

    const savedHeart = page.getByRole("button", {
      name: `Remove ${POSTING_NAME} from saved postings`,
    });
    const unsavedHeart = page.getByRole("button", {
      name: `Save ${POSTING_NAME}`,
    });

    // Normalize to "not saved" rather than trusting the seed fixtures, so the
    // spec is idempotent across runs.
    await page.goto(SEARCH_URL);
    await expect(savedHeart.or(unsavedHeart)).toBeVisible();

    if (await savedHeart.isVisible()) {
      await savedHeart.click();
    }
    await expect(unsavedHeart).toBeVisible();
    await expect(unsavedHeart).toHaveAttribute("aria-pressed", "false");

    // Saving flips the control in place.
    await unsavedHeart.click();
    await expect(savedHeart).toBeVisible();
    await expect(savedHeart).toHaveAttribute("aria-pressed", "true");

    // A single identifier request serves every heart on a page of results.
    savedIdsRequests.length = 0;
    const savedIdsRequest = page.waitForRequest((request) =>
      request.url().includes("/postings/saved/ids"),
    );
    await page.goto("/postings");
    await savedIdsRequest;
    await page.waitForLoadState("networkidle");

    const heartCount = await page
      .getByRole("button", { name: /^(Save |Remove )/ })
      .count();
    expect(heartCount).toBeGreaterThan(1);
    expect(savedIdsRequests).toHaveLength(1);

    // The detail page shares the same provider, so it opens already filled.
    await page.goto(SEARCH_URL);
    await page.getByRole("link", { name: "View details" }).first().click();
    await expect(
      page.getByRole("heading", { name: POSTING_NAME }),
    ).toBeVisible();
    await expect(savedHeart).toBeVisible();

    // A failed request reverts the optimistic flip and surfaces a toast.
    await page.route("**/postings/*/save", (route) => route.abort("failed"));
    await savedHeart.click();
    await expect(savedHeart).toBeVisible();
    await expect(page.getByText("Couldn't remove saved posting")).toBeVisible();
    await page.unroute("**/postings/*/save");

    // The saved page mounts its hearts only after the list arrives, so a
    // count-based subscriber dependency used to abort and re-issue this.
    savedIdsRequests.length = 0;
    await page.goto("/saved");
    await expect(
      page.getByRole("heading", { name: POSTING_NAME }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(savedIdsRequests).toHaveLength(1);

    // The saved page lists it, and the state survives a reload.
    await page.goto("/saved");
    await expect(
      page.getByRole("heading", { name: POSTING_NAME }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: POSTING_NAME }),
    ).toBeVisible();

    // Unhearting from /saved keeps the card listed so the change can be undone;
    // only leaving and returning to the page drops it.
    await savedHeart.click();
    await expect(unsavedHeart).toBeVisible();
    await expect(
      page.getByRole("heading", { name: POSTING_NAME }),
    ).toBeVisible();
    await expect(page.getByText(/no longer saved.*undo it/i)).toBeVisible();

    // Undo works while still on the page.
    await unsavedHeart.click();
    await expect(savedHeart).toBeVisible();

    // Unheart again, then leave and come back: now it is gone.
    await savedHeart.click();
    await expect(unsavedHeart).toBeVisible();
    await page.goto("/postings");
    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: POSTING_NAME })).toHaveCount(
      0,
    );

    // Two entries are expected and unrelated to saved postings: the request
    // this test aborted on purpose, and the session-restore probe against
    // /auth/refresh that the client handles on a cold page load.
    const unexpectedConsoleErrors = consoleErrors.filter(
      (entry) =>
        !entry.includes("Failed to load resource: net::ERR_FAILED") &&
        !entry.includes(
          "Failed to load resource: the server responded with a status of 401",
        ),
    );
    expect(unexpectedConsoleErrors).toEqual([]);
  });
});
