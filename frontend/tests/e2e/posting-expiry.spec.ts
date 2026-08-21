import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures";

/**
 * Covers the owner-facing half of posting expiry: setting a date through the
 * wizard, seeing it reflected on the dashboard, and being stopped from saving a
 * date that has already passed.
 *
 * The sweep itself is not driven from here -- it runs on a poll interval in its
 * own worker process, and asserting on it belongs in the integration suite
 * (backend/src/test/features/postings/posting-expiry.integration.test.ts).
 */

test.describe.configure({ mode: "serial" });

function futureDateInput(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

async function openFirstEditableListing(page: import("@playwright/test").Page) {
  await page.goto("/postings/manage");
  await expect(page.getByText("Posting dashboard")).toBeVisible();

  const editLink = page.getByRole("link", { name: "Edit" }).first();
  await expect(editLink).toBeVisible();
  await editLink.click();

  const availabilityStep = page
    .getByRole("navigation", { name: "Posting steps" })
    .getByRole("button", { name: /Availability/ });
  await expect(availabilityStep).toBeVisible();
  await availabilityStep.click();
}

test("an owner can set an expiry date and see it on the dashboard", async ({
  ownerPage,
}) => {
  const consoleErrors: string[] = [];
  ownerPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await openFirstEditableListing(ownerPage);

  const expiryField = ownerPage.getByLabel(/Expiry date/i);
  await expect(expiryField).toBeVisible();
  await expiryField.fill(futureDateInput(5));

  await ownerPage
    .getByRole("navigation", { name: "Posting steps" })
    .getByRole("button", { name: /Review/ })
    .click();
  await ownerPage
    .getByRole("button", { name: /Save changes|Create draft/ })
    .click();

  await ownerPage.goto("/postings/manage");
  await expect(
    ownerPage.getByText(/Expires in \d+ days|Expires today/).first(),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("the wizard refuses an expiry date in the past", async ({ ownerPage }) => {
  await openFirstEditableListing(ownerPage);

  const expiryField = ownerPage.getByLabel(/Expiry date/i);
  await expect(expiryField).toBeVisible();
  await expiryField.fill("2020-01-01");

  // The wizard validates as you type, so the error and the blocked Continue
  // button appear without needing to attempt the step change.
  await expect(
    ownerPage.getByText(/Expiry date must be in the future/i),
  ).toBeVisible();
  await expect(
    ownerPage.getByRole("button", { name: "Continue" }),
  ).toBeDisabled();
});
