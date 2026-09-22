import { expect, test, type Page, type Response } from "@playwright/test";
import { login } from "./helpers/auth";

const ACCESS_TOKEN_REFRESH_DELAY_MS = 14 * 60 * 1_000;

function isRefreshResponse(response: Response): boolean {
  return new URL(response.url()).pathname.endsWith("/api/v1/auth/refresh");
}

function trackUnexpectedFailures(page: Page) {
  const protectedUnauthorizedResponses: string[] = [];
  const consoleErrors: string[] = [];

  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;

    if (
      response.status() === 401 &&
      pathname.startsWith("/api/v1/") &&
      !pathname.endsWith("/auth/local/login") &&
      !pathname.endsWith("/auth/refresh")
    ) {
      protectedUnauthorizedResponses.push(pathname);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  return { consoleErrors, protectedUnauthorizedResponses };
}

async function verifyProtectedRequest(page: Page): Promise<void> {
  const optionsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/auth/mfa/verify/options"),
  );

  await page.getByRole("button", { name: "Security" }).click();
  expect((await optionsResponse).status()).toBe(200);
}

test("refreshes an active session before its access token expires", async ({
  page,
}) => {
  await page.clock.install({
    time: new Date(Date.now() + 30 * 60 * 1_000),
  });
  const failures = trackUnexpectedFailures(page);
  const refreshStatuses: number[] = [];

  await login(page, "viewer-one", { nextPath: "/account" });
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  page.on("response", (response) => {
    if (isRefreshResponse(response)) {
      refreshStatuses.push(response.status());
    }
  });

  await page.clock.fastForward(13 * 60 * 1_000);
  expect(refreshStatuses).toEqual([]);

  await page.clock.fastForward(70_000);
  await expect.poll(() => refreshStatuses).toEqual([200]);

  await verifyProtectedRequest(page);
  expect(failures.protectedUnauthorizedResponses).toEqual([]);
  expect(failures.consoleErrors).toEqual([]);
});

test("preserves the session and retries a transient refresh failure", async ({
  page,
}) => {
  await page.clock.install({ time: new Date() });
  const failures = trackUnexpectedFailures(page);
  const refreshStatuses: number[] = [];
  let refreshRequests = 0;

  await login(page, "viewer-one", { nextPath: "/account" });
  await page.route("**/api/v1/auth/refresh", async (route) => {
    refreshRequests += 1;

    if (refreshRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "Temporarily unavailable.",
          data: null,
          error: { code: "TEMPORARY_FAILURE" },
          meta: { requestId: "refresh-transient" },
        }),
      });
      return;
    }

    await route.continue();
  });
  page.on("response", (response) => {
    if (isRefreshResponse(response)) {
      refreshStatuses.push(response.status());
    }
  });

  await page.clock.fastForward(ACCESS_TOKEN_REFRESH_DELAY_MS + 10_000);
  await expect.poll(() => refreshStatuses).toEqual([503]);

  await page.clock.fastForward(4_999);
  expect(refreshRequests).toBe(1);

  await page.clock.fastForward(1);
  await expect.poll(() => refreshStatuses).toEqual([503, 200]);

  await verifyProtectedRequest(page);
  expect(failures.protectedUnauthorizedResponses).toEqual([]);
  expect(
    failures.consoleErrors.filter(
      (message) => !message.includes("server responded with a status of 503"),
    ),
  ).toEqual([]);
});

test("does not restore authentication when logout races a scheduled refresh", async ({
  page,
}) => {
  await page.clock.install({ time: new Date() });
  const failures = trackUnexpectedFailures(page);
  let releaseRefresh: (() => void) | undefined;
  let markRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  const refreshRelease = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  await login(page, "viewer-one", { nextPath: "/account" });
  await page.route("**/api/v1/auth/refresh", async (route) => {
    markRefreshStarted?.();
    await refreshRelease;
    await route.continue().catch(() => undefined);
  });

  const abortedRefresh = page.waitForEvent("requestfailed", (request) =>
    new URL(request.url()).pathname.endsWith("/auth/refresh"),
  );
  await page.clock.fastForward(ACCESS_TOKEN_REFRESH_DELAY_MS);
  await refreshStarted;

  await page.locator('[aria-label$="account menu"]').click();
  await Promise.all([
    page.waitForURL("**/login"),
    page.getByRole("button", { name: "Log out", exact: true }).click(),
    abortedRefresh,
  ]);
  releaseRefresh?.();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Welcome back", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label$="account menu"]')).toHaveCount(0);
  expect(failures.consoleErrors).toEqual([]);
});
