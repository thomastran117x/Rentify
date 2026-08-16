import { expect, test, type Page } from "@playwright/test";

const USERNAME = "renter-one";
const OWNER_USERNAME = "owner-one";
const PASSWORD = "Rentify123!";

const ORGANIZATION_UUID = "00000000-0000-0000-1040-000000000001";
/** The seeded published post whose comments are open. */
const POST_PATH = `/organizations/${ORGANIZATION_UUID}/blog/introducing-weekend-stays`;
/** The seeded published post whose comments are closed. */
const CLOSED_POST_PATH = `/organizations/${ORGANIZATION_UUID}/blog/five-ways-to-feel-at-home`;

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

async function login(page: Page, nextPath: string, username = USERNAME) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(username);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("blog comments", () => {
  test("a guest reads comments and is invited to sign in", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.goto(POST_PATH);

    await expect(page.getByTestId("blog-comments")).toBeVisible();
    // Seeded comments are readable with no session at all.
    await expect(page.getByTestId("blog-comment").first()).toBeVisible();
    await expect(page.getByTestId("blog-comments-signin")).toBeVisible();
    await expect(page.getByTestId("blog-comment-composer")).toHaveCount(0);

    // Both tombstone labels are rendered from the seeded fixtures.
    await expect(
      page.getByText("This comment was deleted.").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Removed by the organization.").first(),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("a closed post says so and offers no composer", async ({ page }) => {
    await page.goto(CLOSED_POST_PATH);

    await expect(page.getByTestId("blog-comments-closed")).toBeVisible();
    await expect(page.getByTestId("blog-comment-composer")).toHaveCount(0);
  });

  // A single sign-in covers every authenticated assertion in this test: the
  // login endpoint is rate limited and this suite shares that budget with the
  // other specs.
  test("a signed-in reader posts, edits and removes a comment", async ({
    page,
  }) => {
    await login(page, POST_PATH);
    const consoleErrors = collectConsoleErrors(page);

    const composer = page.getByTestId("blog-comment-composer");
    const submit = page.getByTestId("blog-comment-submit");
    await expect(composer).toBeVisible();

    // Validation path: an empty composer cannot be submitted.
    await expect(submit).toBeDisabled();

    const body = `Playwright check ${Date.now()}`;
    const posted = page.getByTestId("blog-comment").filter({ hasText: body });

    await composer.fill(body);
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(posted).toBeVisible();
    await expect(composer).toHaveValue("");

    // Comments are durably persisted, so the thread survives a reload.
    await page.reload();
    await expect(posted).toBeVisible();

    // Anchored on the id from here on: removing a comment blanks its body, so
    // a text-based locator would go stale exactly when it is needed most.
    const commentId = await posted.getAttribute("data-comment-id");
    expect(commentId).toBeTruthy();
    const comment = page.locator(`[data-comment-id="${commentId}"]`);

    // Edit, inside the 15-minute window. The replacement deliberately avoids
    // the word the "(edited)" badge uses, so the two are distinguishable.
    const edited = `${body} reworded`;
    await comment.getByTestId("blog-comment-edit").click();
    await comment.getByTestId("blog-comment-edit-input").fill(edited);
    await comment.getByTestId("blog-comment-edit-save").click();

    await expect(comment).toContainText(edited);
    await expect(comment.getByText("(edited)")).toBeVisible();

    // Remove, leaving an author tombstone in place.
    await comment.getByTestId("blog-comment-remove").click();
    await expect(comment.getByTestId("blog-comment-tombstone")).toHaveAttribute(
      "data-deleted-by",
      "author",
    );

    expect(consoleErrors).toEqual([]);
  });

  // The one test that opens several contexts. Sessions are deliberately not
  // shared: the device id travels in local storage, so a reused storage state
  // presents an already-rotated refresh token and lands back on the login page.
  test("a guest receives comments, typing and presence live", async ({
    browser,
  }) => {
    // Three contexts, because the point of the socket is what one party sees
    // while another acts. No page reloads once the post is open.
    const authorContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const managerContext = await browser.newContext();
    const authorPage = await authorContext.newPage();
    const guestPage = await guestContext.newPage();
    const managerPage = await managerContext.newPage();
    const guestErrors = collectConsoleErrors(guestPage);

    try {
      await login(authorPage, POST_PATH);
      await expect(
        authorPage.getByTestId("blog-comment-composer"),
      ).toBeVisible();

      // The guest never signs in, and still holds a socket.
      await guestPage.goto(POST_PATH);
      await expect(guestPage.getByTestId("blog-comments")).toBeVisible();

      // Presence counts the anonymous reader alongside the signed-in one.
      await expect(guestPage.getByTestId("blog-comments-presence")).toBeVisible(
        { timeout: 15_000 },
      );

      // Typing: a keystroke from the author raises the indicator for a reader
      // who is not signed in.
      await authorPage.getByTestId("blog-comment-composer").fill("Typing");
      await expect(guestPage.getByText(/renter-one is typing/i)).toBeVisible({
        timeout: 15_000,
      });

      // The headline assertion: a comment lands on a page with no session that
      // never navigated or refetched.
      const body = `Socket check ${Date.now()}`;
      await authorPage.getByTestId("blog-comment-composer").fill(body);
      await authorPage.getByTestId("blog-comment-submit").click();

      const guestArrival = guestPage
        .getByTestId("blog-comment")
        .filter({ hasText: body });
      await expect(guestArrival).toBeVisible({ timeout: 15_000 });

      // Anchored on the id before the removal below blanks the body.
      const commentId = await guestArrival.getAttribute("data-comment-id");
      const guestView = guestPage.locator(`[data-comment-id="${commentId}"]`);

      // A manager removes it, and both other pages relabel it in place.
      await login(managerPage, POST_PATH, OWNER_USERNAME);
      const managerView = managerPage
        .getByTestId("blog-comment")
        .filter({ hasText: body });
      await expect(managerView).toBeVisible();
      await managerView.getByTestId("blog-comment-remove").click();

      await expect(
        guestView.getByTestId("blog-comment-tombstone"),
      ).toHaveAttribute("data-deleted-by", "moderator", { timeout: 15_000 });
      await expect(
        authorPage
          .getByTestId("blog-comment")
          .filter({ hasText: "Removed by the organization." })
          .first(),
      ).toBeVisible({ timeout: 15_000 });

      expect(guestErrors).toEqual([]);
    } finally {
      await authorContext.close();
      await guestContext.close();
      await managerContext.close();
    }
  });
});
