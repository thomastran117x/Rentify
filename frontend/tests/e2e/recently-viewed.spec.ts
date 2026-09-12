import { expect, test, type Page } from "@playwright/test";

/**
 * Recently viewed postings, end to end.
 *
 * Two tests, both self-contained: Playwright gives each test a fresh context,
 * so nothing carries over between them and each builds the history it needs.
 * The signed-in half is one long test rather than several, because the login
 * endpoint is rate limited and this suite shares that budget with every other
 * spec -- the same reason `saved-postings.spec.ts` logs in exactly once.
 *
 * This spec mutates `renter-one`'s recently viewed rows on the shared local
 * stack. No other spec reads them, and it clears up after itself.
 */

const USERNAME = "renter-one";
const PASSWORD = "Rentify123!";

// Seeded postings that are published with no expiry. The expiry fixtures are
// deliberately avoided: the posting-expiry worker pauses those the moment their
// date passes, which would make this spec fail on one particular day.
const POSTING_A = {
  id: "00000000-0000-0000-2000-000000000003",
  name: "Annex Guest Room",
};
const POSTING_B = {
  id: "00000000-0000-0000-2000-000000000004",
  name: "Contractor Tool Pack",
};
const POSTING_C = {
  id: "00000000-0000-0000-2000-000000000006",
  name: "Weekend Trail E-Bike",
};

test.describe.configure({ mode: "serial" });

/**
 * Console errors, plus the URL and status of any failed response.
 *
 * The browser only reports "Failed to load resource: ... 400", which names
 * nothing; pairing it with the response makes a failure here actionable.
 */
function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });

  return errors;
}

// Third-party and content-free noise. The bare "Failed to load resource"
// console line names nothing, and every response it refers to is already
// captured with its URL and status by the response listener above.
const IGNORED_ERROR_PATTERNS = [
  "favicon",
  "Failed to load resource",
  "challenges.cloudflare.com",
  // How the app discovers that a visitor is signed out: every anonymous page
  // load probes for a refresh cookie and is told no. Expected, not a fault.
  "/auth/refresh",
];

function unexpected(errors: string[]): string[] {
  return errors.filter(
    (message) =>
      !IGNORED_ERROR_PATTERNS.some((pattern) => message.includes(pattern)),
  );
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

async function login(page: Page, nextPath = "/saved/recent") {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(USERNAME);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Opens a posting, which is what records the view.
 *
 * Waits for the entry to reach localStorage rather than just for the heading:
 * the recorder writes from an effect, so navigating away as soon as the page
 * paints can outrun it.
 */
async function viewPosting(page: Page, posting: { id: string; name: string }) {
  // Registered before navigating, so it catches the response whenever the
  // client actually fires it -- which happens from a `useEffect` well after
  // `goto` itself resolves.
  const viewRecorded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/postings/${posting.id}/activity/view`),
  );

  await page.goto(`/postings/${posting.id}`);
  await expect(page.getByRole("heading", { name: posting.name })).toBeVisible();

  // Waits for the view to actually reach the server, not just for the local
  // write (which happens synchronously, well before the network round trip
  // even starts). The recorder is fire-and-forget, so navigating away as soon
  // as the heading paints can cut the request short -- the local entry would
  // still be there, but the next page's fetch from the account would not see
  // it, which looks identical to a real bug from the outside.
  await viewRecorded;
}
/** Card titles on the recently viewed page or strip, newest first. */
async function titles(page: Page): Promise<string[]> {
  return page
    .getByRole("list")
    .getByRole("heading")
    .getByRole("link")
    .allTextContents();
}

/** The newest `count` card titles. */
async function newest(page: Page, count: number): Promise<string[]> {
  return (await titles(page)).slice(0, count);
}

test.describe("recently viewed postings", () => {
  test("a signed-out visitor builds a browser-local history", async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);

    // With no history, the marketing page must look exactly as it always has.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Recently viewed" }),
    ).toHaveCount(0);

    await viewPosting(page, POSTING_A);
    await viewPosting(page, POSTING_B);

    // The strip appears on the home page, newest first.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Recently viewed" }),
    ).toBeVisible();
    await expect
      .poll(async () => titles(page))
      .toEqual([POSTING_B.name, POSTING_A.name]);

    // And on the browse page.
    await page.goto("/postings");
    await expect.poll(async () => titles(page)).toContain(POSTING_B.name);

    // Re-opening promotes rather than duplicating.
    await viewPosting(page, POSTING_A);
    await page.goto("/saved/recent");
    await expect
      .poll(async () => titles(page))
      .toEqual([POSTING_A.name, POSTING_B.name]);

    // Signed-out visitors get their list, not a sign-in wall.
    await expect(page.getByText(/kept in this browser only/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    expect(unexpected(consoleErrors)).toEqual([]);
  });

  test("signing in merges the local history, which then persists and can be cleared", async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);

    // Build a signed-out history first, so signing in has something to merge.
    await viewPosting(page, POSTING_A);
    await viewPosting(page, POSTING_B);

    await login(page, "/saved/recent");

    // The whole merge contract: this can only pass if the local mirror was
    // pushed up on sign-in and adopted back from the account. Asserted on the
    // newest entries rather than the whole list, because the account may
    // still carry older history from a previous run of this spec.
    await expect
      .poll(async () => newest(page, 2))
      .toEqual([POSTING_B.name, POSTING_A.name]);
    await expect(page.getByText(/follow you between devices/i)).toBeVisible();

    // A view recorded while signed in survives a reload, which it can only do
    // from the server.
    await viewPosting(page, POSTING_C);
    await page.goto("/saved/recent");
    await expect
      .poll(async () => newest(page, 3))
      .toEqual([POSTING_C.name, POSTING_B.name, POSTING_A.name]);

    await page.reload();
    await expect.poll(async () => titles(page)).toContain(POSTING_C.name);

    // Removing one entry sticks across a reload, proving the delete reached the
    // account rather than only localStorage.
    await page
      .getByRole("button", {
        name: `Remove ${POSTING_A.name} from recently viewed`,
      })
      .click();
    await expect.poll(async () => titles(page)).not.toContain(POSTING_A.name);

    await page.reload();
    await expect.poll(async () => titles(page)).not.toContain(POSTING_A.name);

    // The opt-out is deliberately not exercised here. It is covered by
    // `recently-viewed.integration.test.ts` (the server stops recording) and
    // by the provider unit tests (the client stops writing its mirror).
    // Driving it through the UI would mean mutating a preference on a shared
    // seeded account, and would cost four more full page loads in a test that
    // already makes enough of them to strain refresh-token rotation.

    // Clearing empties the page, and the strips with it.
    await page.goto("/saved/recent");
    await page.getByRole("button", { name: "Clear history" }).click();
    await page.getByRole("button", { name: "Yes, clear history" }).click();
    await expect(
      page.getByText("You haven't viewed any postings yet"),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByText("You haven't viewed any postings yet"),
    ).toBeVisible();

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Recently viewed" }),
    ).toHaveCount(0);

    expect(unexpected(consoleErrors)).toEqual([]);
  });
});
