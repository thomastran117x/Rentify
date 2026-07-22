import { expect, test } from "@playwright/test";

// Browser validation for the username-recovery entry point added alongside the
// OAuth onboarding work. Real Google/Microsoft OAuth popups can't be automated,
// so the first-run welcome modal is covered by unit tests; this spec drives the
// forgot-username recovery UI in a real browser.
test("username recovery is reachable from the sign-in recovery dialog", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      }),
    });
  });

  // The forgot-password route redirects into the login shell with the recovery
  // dialog open.
  await page.goto("/login?recovery=account");

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "I can't log in" }),
  ).toBeVisible();

  await dialog.getByRole("button", { name: /I forgot my username/i }).click();

  await expect(
    dialog.getByRole("heading", { name: "Forgot username" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Email")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Email me my username" }),
  ).toBeVisible();

  // Client-side validation rejects a malformed email before any network call.
  await dialog.getByLabel("Email").fill("not-an-email");
  await dialog.getByRole("button", { name: "Email me my username" }).click();
  await expect(
    dialog.getByText("Enter a valid email address."),
  ).toBeVisible();

  // The user can return to the recovery options.
  await dialog.getByRole("button", { name: "Back to recovery options" }).click();
  await expect(
    dialog.getByRole("button", { name: /I forgot my password/i }),
  ).toBeVisible();
});
