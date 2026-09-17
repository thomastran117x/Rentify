import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

// Mutates seeded bookings (approve, decline, convert), so it runs serially and
// finds its targets through dashboard filters instead of fixed ids.
test.describe.configure({ mode: "serial" });

function collectUnexpectedConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    // Rejected API calls surface as resource-load errors; the flows assert on
    // the banner those produce instead.
    if (
      message.type() === "error" &&
      !/Failed to load resource/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });

  return errors;
}

async function openOwnerQueue(page: Page, actionLabel: string) {
  await page.goto("/bookings");
  await expect(page.getByRole("button", { name: "Owner" })).toBeVisible();
  await page.getByRole("button", { name: "Owner" }).click();
  await page.getByLabel("Action needed").selectOption({ label: actionLabel });
}

test.describe("owner booking decisions", () => {
  test("owner approves, declines, and converts; stale approval is rejected", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = collectUnexpectedConsoleErrors(page);

    try {
      await login(page, "owner-one", { nextPath: "/bookings" });

      // Approve from the dashboard.
      await openOwnerQueue(page, "Approval");
      const approveButtons = page.getByRole("button", { name: "Approve" });
      await expect(approveButtons.first()).toBeVisible();
      const pendingBefore = await approveButtons.count();
      test.info().annotations.push({
        type: "pending-before",
        description: String(pendingBefore),
      });
      expect(pendingBefore).toBeGreaterThanOrEqual(2);

      await approveButtons.first().click();
      await expect(
        page.getByText(
          "Booking request approved. The renter has been asked to pay.",
        ),
      ).toBeVisible();
      await expect(approveButtons).toHaveCount(pendingBefore - 1);

      // Persisted across a reload.
      await page.reload();
      await page
        .getByLabel("Action needed")
        .selectOption({ label: "Approval" });
      await expect(approveButtons).toHaveCount(pendingBefore - 1);

      // Stale decision: approve the next request from its detail page in a
      // second tab, then retry from the dashboard that still shows it pending.
      const staleCard = page
        .locator("article")
        .filter({ has: page.getByRole("button", { name: "Approve" }) })
        .first();
      const staleHref = await staleCard
        .getByRole("link", { name: "Messages" })
        .getAttribute("href");
      expect(staleHref).toMatch(/^\/bookings\/[0-9a-f-]+$/i);

      const detailPage = await context.newPage();
      await detailPage.goto(staleHref!);
      await detailPage.getByRole("button", { name: "Approve" }).click();
      await expect(
        detailPage.getByText(
          "Booking request approved. The renter has been asked to pay.",
        ),
      ).toBeVisible();
      await expect(
        detailPage.getByRole("button", { name: "Approve" }),
      ).toHaveCount(0);
      await detailPage.close();

      await staleCard.getByRole("button", { name: "Approve" }).click();
      await expect(
        page.getByText("Only pending booking requests can be approved."),
      ).toBeVisible();

      // Decline with a note from the detail page, if a pending request remains.
      await page.reload();
      await page
        .getByLabel("Action needed")
        .selectOption({ label: "Approval" });
      if ((await approveButtons.count()) > 0) {
        const declineHref = await page
          .locator("article")
          .filter({ has: page.getByRole("button", { name: "Approve" }) })
          .first()
          .getByRole("link", { name: "Messages" })
          .getAttribute("href");
        await page.goto(declineHref!);
        await page.getByRole("button", { name: "Decline" }).click();
        await page
          .getByRole("textbox", { name: "Decline note (optional)" })
          .fill("Playwright: dates conflict");
        await page.getByRole("button", { name: "Confirm decline" }).click();
        await expect(page.getByText("Booking request declined.")).toBeVisible();
        await expect(
          page.getByText("Playwright: dates conflict"),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByText("Playwright: dates conflict"),
        ).toBeVisible();
      }

      // Convert a paid booking into a renting.
      await openOwnerQueue(page, "Convert to renting");
      const convertButtons = page.getByRole("button", {
        name: "Convert to renting",
      });
      await expect(convertButtons.first()).toBeVisible();
      const convertBefore = await convertButtons.count();
      await convertButtons.first().click();
      await expect(
        page.getByText("Booking converted into a confirmed renting."),
      ).toBeVisible();
      await expect(convertButtons).toHaveCount(convertBefore - 1);

      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("an operator sees the owner queue without decision controls", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await login(page, "renter-two", { nextPath: "/bookings" });
      await openOwnerQueue(page, "Approval");
      await expect(page.locator("article").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(
        0,
      );
      await expect(page.getByRole("button", { name: "Decline" })).toHaveCount(
        0,
      );
    } finally {
      await context.close();
    }
  });

  test("a renter can start payment on an approved booking", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = collectUnexpectedConsoleErrors(page);

    try {
      await login(page, "renter-one", { nextPath: "/bookings" });
      await page.getByRole("button", { name: "Renter" }).click();

      const payButton = page
        .getByRole("button", { name: /^(Pay now|Retry payment)$/ })
        .first();
      await expect(payButton).toBeVisible();
      await payButton.click();

      // Local PayPal credentials are placeholders, so checkout either fails
      // gracefully (banner) or, with real sandbox credentials, redirects.
      await expect
        .poll(
          async () =>
            !page.url().startsWith("http://127.0.0.1:3040") ||
            (await page
              .getByText(
                "We couldn't start checkout right now. Please try again.",
              )
              .isVisible()),
          { timeout: 20000 },
        )
        .toBe(true);

      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
