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

test("hero autocomplete navigates to postings with the selected suggestion", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/");

  const searchInput = page.getByPlaceholder("What are you looking for?");
  await searchInput.fill("tor");

  await expect(
    page.getByRole("button", { name: "Downtown Toronto Loft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Downtown Toronto Loft" }).click();

  await expect(page).toHaveURL(/\/postings/);

  const url = new URL(page.url());
  expect(url.pathname).toBe("/postings");
  expect(url.searchParams.get("q")).toBe("Downtown Toronto Loft");
  expect(consoleErrors).toEqual([]);
});

test("postings autocomplete preserves the family filter when a suggestion is selected", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/postings?family=vehicle");

  const searchInput = page.getByPlaceholder(
    "Search cameras, private rooms, bikes, tools...",
  );
  await searchInput.fill("trail");

  await expect(
    page.getByRole("button", { name: "Weekend Trail E-Bike" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Weekend Trail E-Bike" }).click();

  await expect(page).toHaveURL(/\/postings/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/postings");
  expect(url.searchParams.get("family")).toBe("vehicle");
  expect(url.searchParams.get("q")).toBe("Weekend Trail E-Bike");
  expect(consoleErrors).toEqual([]);
});

test("keyboard navigation selects an autocomplete suggestion", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/postings?family=vehicle");

  const searchInput = page.getByPlaceholder(
    "Search cameras, private rooms, bikes, tools...",
  );
  await searchInput.fill("trail");

  await expect(
    page.getByRole("button", { name: "Weekend Trail E-Bike" }),
  ).toBeVisible();
  await searchInput.press("ArrowDown");
  await searchInput.press("Enter");

  await expect(page).toHaveURL(/\/postings/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/postings");
  expect(url.searchParams.get("family")).toBe("vehicle");
  expect(url.searchParams.get("q")).toBe("Weekend Trail E-Bike");
  expect(consoleErrors).toEqual([]);
});

test("raw search submission still works when autocomplete fails", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.route("**/api/v1/postings/autocomplete**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        message: "Autocomplete unavailable.",
        data: null,
        error: {
          code: "INTERNAL_SERVER_ERROR",
        },
      }),
    });
  });

  await page.goto("/");

  const searchInput = page.getByPlaceholder("What are you looking for?");
  await searchInput.fill("tor");

  await expect(page.getByRole("listbox")).toHaveCount(0);
  await searchInput.press("Enter");

  await expect(page).toHaveURL(/\/postings/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/postings");
  expect(url.searchParams.get("q")).toBe("tor");
  expect(consoleErrors).toEqual([]);
});
