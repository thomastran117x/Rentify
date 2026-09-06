import { expect, test, type Page } from "@playwright/test";

/**
 * Browser validation for the live email availability check on signup.
 *
 * Drives the real form against the real backend: `owner1@rentify.local` is a
 * seeded account, so it is genuinely taken, and the generated address
 * genuinely is not.
 */
test.describe("signup email availability", () => {
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

  function emailField(page: Page) {
    // Role-scoped: the page footer also has an "Email" link.
    return page.getByRole("textbox", { name: "Email" });
  }

  test("reports a seeded address as taken and blocks submission", async ({
    page,
  }) => {
    await page.goto("/signup");

    await emailField(page).fill("owner1@rentify.local");

    await expect(page.getByText("This email is already in use.")).toBeVisible({
      timeout: 15_000,
    });

    // Filling the rest and submitting must not reach the API.
    let signupCalled = false;
    await page.route("**/api/v1/auth/local/signup", async (route) => {
      signupCalled = true;
      await route.abort();
    });

    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Username").fill(`jane-${Date.now()}`);
    await page.getByLabel("Password", { exact: true }).fill("StrongPassw0rd!");
    await page.getByLabel("Confirm password").fill("StrongPassw0rd!");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForTimeout(1_000);
    expect(signupCalled).toBe(false);
  });

  test("says nothing about an address nobody holds", async ({ page }) => {
    // The absence of a verdict is the feature: announcing a free address would
    // make the field a readout of which addresses are registered.
    await page.goto("/signup");

    const availabilityResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/auth/email/available") &&
        response.status() === 200,
      { timeout: 15_000 },
    );

    await emailField(page).fill(`nobody-${Date.now()}@example.com`);

    const response = await availabilityResponse;
    const body = (await response.json()) as {
      data?: { available?: boolean; reason?: string | null };
    };

    expect(body.data?.available).toBe(true);
    expect(body.data?.reason).toBeNull();
    await expect(page.getByText("This email is already in use.")).toBeHidden();
  });

  test("checks nothing until the value looks like an address", async ({
    page,
  }) => {
    // Format errors are the field validator's job; a half-typed address must
    // not spend a request per keystroke.
    await page.goto("/signup");

    let requestCount = 0;
    await page.route("**/auth/email/available*", async (route) => {
      requestCount += 1;
      await route.continue();
    });

    await emailField(page).fill("jane@");
    await page.waitForTimeout(1_500);

    expect(requestCount).toBe(0);
  });

  test("keeps the form usable when the check fails", async ({ page }) => {
    // The backend still enforces uniqueness on submit, so a failed check must
    // never be the reason someone cannot sign up.
    await page.goto("/signup");

    await page.route("**/auth/email/available*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Something broke." },
        }),
      });
    });

    await emailField(page).fill("jane.doe@example.com");

    await expect(
      page.getByText("We couldn't check that email right now."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Create account" }),
    ).toBeEnabled();
  });
});
