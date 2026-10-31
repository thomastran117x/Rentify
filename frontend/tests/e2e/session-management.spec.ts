import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

const FIREFOX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

function trackUnexpectedResponses(page: Page) {
  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpErrors.push(
        `${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`,
      );
    }
  });
  return { consoleErrors, httpErrors };
}

test("manages two signed-in browser sessions from the account security tab", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const primaryContext = await browser.newContext();
  const otherContext = await browser.newContext({
    userAgent: FIREFOX_USER_AGENT,
  });
  const primaryPage = await primaryContext.newPage();
  const otherPage = await otherContext.newPage();
  const primaryFailures = trackUnexpectedResponses(primaryPage);
  const otherFailures = trackUnexpectedResponses(otherPage);

  await login(primaryPage, "owner-one", { nextPath: "/account" });
  await login(otherPage, "owner-one", { nextPath: "/account" });

  let failSessionList = true;
  await primaryPage.route("**/api/v1/auth/sessions", async (route) => {
    if (route.request().method() === "GET" && failSessionList) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "Session service is temporarily unavailable.",
          data: null,
          error: { code: "TEMPORARY_FAILURE" },
          meta: { requestId: "session-management-e2e" },
        }),
      });
      return;
    }

    await route.continue();
  });

  await primaryPage.getByRole("button", { name: /^Security$/ }).click();
  await expect(
    primaryPage.getByRole("heading", { name: "Where you're signed in" }),
  ).toBeVisible();
  await expect(
    primaryPage.getByText("Your session list is unavailable."),
  ).toBeVisible();

  failSessionList = false;
  await primaryPage.getByRole("button", { name: "Try again" }).click();
  await expect(primaryPage.getByText("Current session")).toBeVisible();
  await expect(
    primaryPage.getByRole("heading", { name: "Firefox on Windows" }).first(),
  ).toBeVisible();

  await primaryPage
    .getByRole("button", { name: "Sign out everywhere" })
    .click();
  const confirmation = primaryPage.getByRole("dialog", {
    name: "Sign out everywhere?",
  });
  await expect(confirmation).toContainText(
    "revokes all personal access tokens",
  );
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toBeHidden();

  const revokeResponse = primaryPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/auth/sessions/revoke-others"),
  );
  await primaryPage
    .getByRole("button", { name: "Sign out of all other sessions" })
    .click();
  expect((await revokeResponse).status()).toBe(200);
  await expect(
    primaryPage.getByText(/other session(?:s)? (?:was|were) signed out\./),
  ).toBeVisible();
  await expect(primaryPage.getByText("Current session")).toBeVisible();
  await expect(
    primaryPage.getByRole("heading", { name: "Firefox on Windows" }),
  ).toHaveCount(0);

  await otherPage.getByRole("button", { name: /^Security$/ }).click();
  await expect(
    otherPage.getByText(
      "Sign in to manage login methods and connected providers.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    otherPage.getByRole("link", { name: "Log in", exact: true }),
  ).toBeVisible();

  const expectedRevokedRequest = otherFailures.httpErrors.some(
    (failure) => failure.includes("/api/v1/auth/") && failure.endsWith(" 401"),
  );
  expect(expectedRevokedRequest).toBe(true);
  expect({
    consoleErrors: primaryFailures.consoleErrors.filter(
      (message) =>
        !message.includes("status of 503") &&
        !message.includes("status of 400"),
    ),
    httpErrors: primaryFailures.httpErrors.filter(
      (failure) =>
        failure !== "GET /api/v1/auth/sessions 503" &&
        !(
          failure.includes("/cdn-cgi/challenge-platform/") &&
          failure.endsWith(" 400")
        ),
    ),
  }).toEqual({ consoleErrors: [], httpErrors: [] });
  expect(
    otherFailures.consoleErrors.filter(
      (message) =>
        !message.includes("status of 401") &&
        !message.includes("status of 400"),
    ),
  ).toEqual([]);
});
