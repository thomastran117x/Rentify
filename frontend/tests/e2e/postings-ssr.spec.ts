import { expect, test, type Page } from "@playwright/test";

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  return errors;
}

test("server-rendered postings search and detail pages load without client boundary errors", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/postings?q=Beltline%20Designer%20Flat");

  await expect(
    page.getByRole("heading", { name: "Beltline Designer Flat" }),
  ).toBeVisible();
  await expect(page.getByText("Fetch error")).toHaveCount(0);

  await page.getByRole("link", { name: "View details" }).first().click();

  await expect(
    page.getByRole("heading", { name: "Beltline Designer Flat" }),
  ).toBeVisible();
  await expect(page.getByText("We couldn't load this posting right now.")).toHaveCount(0);

  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Beltline Designer Flat" }),
  ).toBeVisible();
  expect(
    consoleErrors.some((entry) => entry.includes("Attempted to call getDeviceId")),
  ).toBe(false);
});

test("server-rendered postings search shows the normal empty state for no matches", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/postings?q=zzzz-nonexistent-rentify");

  await expect(
    page.getByText("No postings matched your search. Try broadening your filters."),
  ).toBeVisible();
  await expect(page.getByText("Fetch error")).toHaveCount(0);
  expect(
    consoleErrors.some((entry) => entry.includes("Attempted to call getDeviceId")),
  ).toBe(false);
});
