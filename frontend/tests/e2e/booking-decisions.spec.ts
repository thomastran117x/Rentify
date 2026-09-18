import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

// Consumes the pending owner-one requests seeded as fixtures 54-56
// (backend/src/app/seeds/fixtures/bookings.ts): 54 is approved and then paid for
// by renter-five through the checkout page, 55 is approved from a second tab to exercise a stale
// decision, and 56 is declined. Re-seed (`npm --prefix backend run seed`)
// before re-running. Conversion is not exercised here: a paid, unconverted
// booking cannot be seeded without tripping the payment repair invariant, so it
// is covered by unit and backend tests instead.
test.describe.configure({ mode: "serial" });

const APPROVE_BOOKING_ID = "00000000-0000-0000-3000-000000000054";
const STALE_BOOKING_ID = "00000000-0000-0000-3000-000000000055";
const DECLINE_BOOKING_ID = "00000000-0000-0000-3000-000000000056";

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

async function openOwnerApprovalQueue(page: Page) {
  await page.goto("/bookings");
  await page.getByRole("button", { name: "Owner" }).click();
  await page.getByLabel("Action needed").selectOption({ label: "Approval" });
}

function bookingCard(page: Page, bookingId: string) {
  return page.locator("article").filter({
    has: page.locator(`a[href="/bookings/${bookingId}"]`),
  });
}

test.describe("owner booking decisions", () => {
  test("an owner approves, declines, and is told when a decision is stale", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = collectUnexpectedConsoleErrors(page);

    try {
      await login(page, "owner-one", { nextPath: "/bookings" });
      await openOwnerApprovalQueue(page);

      // Approve from the dashboard, and confirm it persists across a reload.
      const approveCard = bookingCard(page, APPROVE_BOOKING_ID);
      await approveCard.getByRole("button", { name: "Approve" }).click();
      await expect(
        page.getByText(
          "Booking request approved. The renter has been asked to pay.",
        ),
      ).toBeVisible();
      await expect(approveCard).toHaveCount(0);
      await page.reload();
      await page
        .getByLabel("Action needed")
        .selectOption({ label: "Approval" });
      await expect(bookingCard(page, APPROVE_BOOKING_ID)).toHaveCount(0);

      // Stale decision: approve from the detail page in a second tab, then
      // retry from the dashboard that still shows the request as pending.
      const staleCard = bookingCard(page, STALE_BOOKING_ID);
      await expect(
        staleCard.getByRole("button", { name: "Approve" }),
      ).toBeVisible();

      const detailPage = await context.newPage();
      await detailPage.goto(`/bookings/${STALE_BOOKING_ID}`);
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

      // Decline with a note from the detail page; the note survives a reload.
      await page.goto(`/bookings/${DECLINE_BOOKING_ID}`);
      await page.getByRole("button", { name: "Decline" }).click();
      await page
        .getByRole("textbox", { name: "Decline note (optional)" })
        .fill("Playwright: dates conflict");
      await page.getByRole("button", { name: "Confirm decline" }).click();
      await expect(page.getByText("Booking request declined.")).toBeVisible();
      await page.reload();
      await expect(page.getByText("Playwright: dates conflict")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(
        0,
      );

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
      await openOwnerApprovalQueue(page);
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

  test("the renter reviews the price on the checkout page before paying", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = collectUnexpectedConsoleErrors(page);

    try {
      await login(page, "renter-five", {
        nextPath: `/bookings/${APPROVE_BOOKING_ID}`,
      });

      await page.getByRole("link", { name: "Pay now" }).click();

      await expect(page).toHaveURL(
        new RegExp(`/bookings/${APPROVE_BOOKING_ID}/checkout$`),
      );
      await expect(page.getByText("Charged today")).toBeVisible();
      await expect(page.getByText("Cancellation policy")).toBeVisible();
      await expect(page.getByRole("timer")).toContainText("Hold expires in");

      // Without a frontend PayPal client ID the page offers only the redirect;
      // with sandbox credentials it also embeds the PayPal buttons.
      await expect(
        page
          .getByRole("button", { name: "Continue to PayPal" })
          .or(page.getByRole("button", { name: /Pay on PayPal\.com/ })),
      ).toBeVisible();

      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
