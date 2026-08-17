import { expect, test, type Page } from "@playwright/test";

const USERNAME = "renter-one";
const PASSWORD = "Rentify123!";

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

/**
 * Regression cover for the partial-update fix.
 *
 * "Save profile" sends only username/isPrivate/personalization. `PUT /profile/me`
 * used to coerce every omitted nullable field to null, so this click silently
 * wiped the user's saved phone number and avatar. The phone number lives behind
 * the MFA-gated Security tab, so it is asserted from the API response the page
 * actually receives rather than from the DOM.
 */
test("saving the profile tab preserves the phone number", async ({ page }) => {
  await login(page);

  // Subscribe before the request that answers it. The account page fires
  // getMine() as soon as its authenticated effect runs, so listening only after
  // login() returned would race the response that has already arrived; a reload
  // makes the GET happen after the listener is attached.
  const loadedProfile = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/profile/me") &&
      response.request().method() === "GET",
    { timeout: 15000 },
  );
  await page.reload();

  const body = (await (await loadedProfile).json()) as {
    data: { phoneNumber?: string | null };
  };
  const seededPhone = body.data.phoneNumber ?? null;

  // The fixture is seeded with a phone number; without one this test would
  // pass vacuously.
  expect(seededPhone).toBeTruthy();

  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/profile/me") &&
      response.request().method() === "PUT",
    { timeout: 15000 },
  );

  await page.getByRole("button", { name: "Save profile" }).click();

  const saved = (await (await savedResponse).json()) as {
    data: { phoneNumber?: string | null; username: string };
  };

  expect(saved.data.username).toBe(USERNAME);
  expect(saved.data.phoneNumber ?? null).toBe(seededPhone);
  await expect(page.getByText("Profile saved.")).toBeVisible();
});
