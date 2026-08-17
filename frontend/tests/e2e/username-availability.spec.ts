import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Rentify123!";

// `renter-two` is seeded 5 days into the 30-day rename cooldown, so its locked
// state is reachable without mutating anything.
const COOLDOWN_USERNAME = "renter-two";

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
        return (
          (JSON.parse(rawCaptchaState) as { token?: string }).token?.trim() ??
          ""
        );
      } catch {
        return "";
      }
    });

  if (!(await readCaptchaToken())) {
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "rentify.auth.captcha",
        JSON.stringify({ token: "local-dev-bypass", createdAt: Date.now() }),
      );
      window.dispatchEvent(new Event("rentify-auth-captcha-storage"));
    });
  }

  await expect.poll(readCaptchaToken).not.toBe("");
}

/** Sign in and land on /account. Retried like the other specs' login helper. */
async function login(page: Page, username: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/login?next=%2Faccount");
    await ensureCaptchaToken(page);
    await page.getByRole("textbox", { name: /^Username/i }).fill(username);
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

test("the account page locks the username field during the cooldown", async ({
  page,
}) => {
  await login(page, COOLDOWN_USERNAME);

  const username = page.getByRole("textbox", { name: "Username" });
  await expect(username).toHaveValue(COOLDOWN_USERNAME);
  await expect(username).toBeDisabled();
  await expect(page.getByText(/You can change it again on/i)).toBeVisible();
});

// Browser validation for the live username availability check on signup. This
// drives the real form against the real backend: `renter-one` is a seeded
// account, so it is genuinely taken, and the generated name genuinely is not.
test.describe("signup username availability", () => {
  test.beforeEach(async ({ page }) => {
    // The signup page is for anonymous visitors; stop the session bootstrap
    // from redirecting an authenticated tab away mid-test.
    await page.route("**/api/v1/auth/refresh", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
        }),
      });
    });
  });

  test("reports a seeded username as taken and blocks submission", async ({
    page,
  }) => {
    await page.goto("/signup");

    const username = page.getByLabel("Username");
    await expect(username).toBeVisible();
    await username.fill("renter-one");

    await expect(page.getByText("That username is already taken.")).toBeVisible(
      {
        timeout: 15_000,
      },
    );

    // Filling the rest and submitting must not reach the API.
    let signupCalled = false;
    await page.route("**/api/v1/auth/local/signup", async (route) => {
      signupCalled = true;
      await route.abort();
    });

    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    // Role-scoped: the page footer also has an "Email" link.
    await page
      .getByRole("textbox", { name: "Email" })
      .fill("jane.doe@example.com");
    await page.getByLabel("Password", { exact: true }).fill("StrongPassw0rd!");
    await page.getByLabel("Confirm password").fill("StrongPassw0rd!");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByText("That username is already taken."),
    ).toBeVisible();
    expect(signupCalled).toBe(false);
  });

  test("confirms an unused username as available", async ({ page }) => {
    await page.goto("/signup");

    const candidate = `e2e-free-${Date.now()}`;
    await page.getByLabel("Username").fill(candidate);

    await expect(page.getByText(`${candidate} is available.`)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("does not call the API for a username that fails the format rule", async ({
    page,
  }) => {
    const availabilityCalls: string[] = [];
    await page.route("**/api/v1/auth/username/available*", async (route) => {
      availabilityCalls.push(route.request().url());
      await route.continue();
    });

    await page.goto("/signup");
    await page.getByLabel("Username").fill("no");

    // Comfortably longer than the 400ms debounce.
    await page.waitForTimeout(1500);
    expect(availabilityCalls).toHaveLength(0);
  });
});
