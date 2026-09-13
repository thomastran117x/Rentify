import { expect, test } from "@playwright/test";
import { login } from "./helpers/auth";

// The Apple button only renders when the frontend was built with
// NEXT_PUBLIC_APPLE_OAUTH_CLIENT_ID, and a real Apple round-trip needs a
// registered HTTPS domain, so this spec is opt-in and stops at Apple's popup.
test.skip(
  process.env.E2E_APPLE_OAUTH !== "1",
  "Set E2E_APPLE_OAUTH=1 against a build with NEXT_PUBLIC_APPLE_OAUTH_CLIENT_ID.",
);

const apiBaseUrl =
  process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:8040/api/v1";

test("login offers Sign in with Apple and hands off to Apple's popup", async ({
  page,
}) => {
  // A dummy Services ID makes Apple's own endpoints answer with errors, and the
  // login page's Cloudflare Turnstile widget rejects headless browsers, so only
  // failures from other hosts (our frontend and API) count against the flow.
  const isThirdPartyHost = (url: string) =>
    /(^|\.)(apple\.com|cdn-apple\.com|challenges\.cloudflare\.com)$/.test(
      new URL(url).hostname,
    );
  const failedResponses: string[] = [];
  const pageErrors: string[] = [];
  page.context().on("response", (response) => {
    if (response.status() >= 400 && !isThirdPartyHost(response.url())) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/login");
  const appleButton = page.getByRole("button", { name: "Continue with Apple" });
  await expect(appleButton).toBeVisible();

  const popupPromise = page
    .waitForEvent("popup", { timeout: 15_000 })
    .catch(() => null);
  await appleButton.click();
  const popup = await popupPromise;

  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    expect(new URL(popup.url()).hostname).toBe("appleid.apple.com");
    await popup.close();
    await expect(
      page.getByText(
        "The sign-in popup was closed before authentication finished.",
      ),
    ).toBeVisible({ timeout: 15_000 });
  } else {
    // Without network access to Apple's CDN the SDK cannot load; the UI must
    // say so rather than hang.
    await expect(
      page.getByText("Apple sign-in could not be loaded. Please try again."),
    ).toBeVisible();
  }

  await expect(appleButton).toBeEnabled();
  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("account security lists Apple as a linkable provider", async ({
  page,
}) => {
  await login(page, "owner-one", { nextPath: "/account" });
  await page.getByRole("button", { name: /^Security$/ }).click();

  await expect(page.getByRole("button", { name: "Link Apple" })).toBeVisible({
    timeout: 15_000,
  });
});

test("Apple OAuth API rejects bad input with the standard error shape", async ({
  request,
}) => {
  const malformed = await request.post(`${apiBaseUrl}/auth/oauth/apple`, {
    data: { idToken: "not-a-jwt", nonce: "nonce-value" },
  });
  expect([400, 401]).toContain(malformed.status());
  const malformedBody = await malformed.json();
  expect(malformedBody.data).toBeNull();
  expect(malformedBody.error?.code).toEqual(expect.any(String));

  const missingNonce = await request.post(`${apiBaseUrl}/auth/oauth/apple`, {
    data: { idToken: "not-a-jwt" },
  });
  expect(missingNonce.status()).toBe(400);
  expect((await missingNonce.json()).error?.code).toBe("VALIDATION_ERROR");
});
