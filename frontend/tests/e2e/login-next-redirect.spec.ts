import { expect, test } from "./helpers/fixtures";
import { SEEDED_USERS, login } from "./helpers/auth";

const USERNAME = SEEDED_USERS["renter-one"].username;

test.describe("login ?next= redirect", () => {
  for (const nextPath of [
    "https://example.org",
    "//example.org",
    "/\\example.org",
  ]) {
    test(`ignores the off-site next value ${nextPath} and lands on /`, async ({
      page,
      baseURL,
    }) => {
      const appOrigin = new URL(baseURL ?? page.url()).origin;

      await login(page, USERNAME, { nextPath, waitForNavigation: false });

      await page.waitForURL(
        (url) => url.origin === appOrigin && url.pathname === "/",
        { timeout: 15000 },
      );
      expect(new URL(page.url()).hostname).not.toBe("example.org");
    });
  }

  test("still follows a same-origin next path", async ({ page }) => {
    await login(page, USERNAME, { nextPath: "/account" });

    await expect(page).toHaveURL(/\/account$/);
  });
});
