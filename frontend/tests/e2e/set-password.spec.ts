import { expect, test, type Page } from "@playwright/test";

const USERNAME = "renter-one";
const PASSWORD = "Rentify123!";

async function ensureCaptchaToken(page: Page) {
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "rentify.auth.captcha",
      JSON.stringify({ token: "local-dev-bypass", createdAt: Date.now() }),
    );
    window.dispatchEvent(new Event("rentify-auth-captcha-storage"));
  });
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/login?next=%2Faccount");
    await ensureCaptchaToken(page);
    await page.getByRole("textbox", { name: /^Username/i }).fill(USERNAME);
    await page.getByLabel(/^Password/i).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    try {
      await page.waitForURL(/\/account/, { timeout: 15000 });
      return;
    } catch {
      // Fall through and try again.
    }
  }

  await expect(page).toHaveURL(/\/account/, { timeout: 15000 });
}

async function openSecurityTab(page: Page) {
  await page.getByRole("button", { name: /Security/i }).click();

  const verify = page.getByRole("button", { name: "Verify to continue" });
  if (await verify.isVisible().catch(() => false)) {
    await verify.click();
  }
}

/**
 * OAuth-only accounts have no password to confirm, so the panel drops the
 * current-password field and posts to `/auth/local/password/set` instead.
 *
 * A real passwordless account cannot reach the UI here -- the provider handshake
 * is only stubbed inside the backend integration harness -- so `hasPassword` is
 * forced false at the one endpoint that reports it. Everything past that point
 * is real: the form, the request, and the backend's answer. The 200 path is
 * covered by the backend integration suite.
 */
test("a passwordless account is offered a set-password form", async ({
  page,
}) => {
  await login(page);

  await page.route("**/auth/oauth/providers", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      data: { hasPassword: boolean; providers: unknown[] };
    };
    body.data.hasPassword = false;
    await route.fulfill({ response, json: body });
  });

  await page.goto("/account");
  await openSecurityTab(page);

  await expect(page.getByText("No password set — add one below")).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("button", { name: "Set password" }),
  ).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);

  // A weak password is caught client-side and never reaches the network.
  let setCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/local/password/set")) {
      setCalls += 1;
    }
  });

  await page.getByLabel("New password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm new password").fill("password123");
  await page.getByRole("button", { name: "Set password" }).click();

  await expect(
    page.getByText(/must be at least 8 characters long and include uppercase/i),
  ).toBeVisible();
  expect(setCalls).toBe(0);

  // Mismatched confirmation is caught too.
  await page.getByLabel("New password", { exact: true }).fill("Rentify456!");
  await page.getByLabel("Confirm new password").fill("Rentify457!");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  expect(setCalls).toBe(0);

  // A valid password reaches the real endpoint. This seeded account does have a
  // password, so the backend refuses it -- and the UI shows why rather than
  // pretending it worked.
  const setCall = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/local/password/set") &&
      response.request().method() === "POST",
    { timeout: 20000 },
  );

  await page.getByLabel("New password", { exact: true }).fill("Rentify456!");
  await page.getByLabel("Confirm new password").fill("Rentify456!");
  await page.getByRole("button", { name: "Set password" }).click();

  expect((await setCall).status()).toBe(409);
  await expect(page.getByText(/already has a password/i)).toBeVisible();
});

test("an account with a password still gets the change form", async ({
  page,
}) => {
  await login(page);
  await openSecurityTab(page);

  await expect(page.getByText("Password login enabled")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByLabel("Current password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update password" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Current password is required.")).toBeVisible();
});
