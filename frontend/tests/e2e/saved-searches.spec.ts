import { expect, test, type Page } from "@playwright/test";

const USERNAME = "renter-one";
const PASSWORD = "Rentify123!";

test.describe.configure({ mode: "serial" });

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  return errors;
}

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
        const parsedCaptchaState = JSON.parse(rawCaptchaState) as {
          token?: string;
        };

        return parsedCaptchaState.token?.trim() ?? "";
      } catch {
        return "";
      }
    });

  if (!(await readCaptchaToken())) {
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "rentify.auth.captcha",
        JSON.stringify({
          token: "local-dev-bypass",
          createdAt: Date.now(),
        }),
      );
      window.dispatchEvent(new Event("rentify-auth-captcha-storage"));
    });
  }

  await expect.poll(readCaptchaToken).not.toBe("");
}

async function login(page: Page, nextPath = "/postings") {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(USERNAME);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Clears any search this spec left behind, so re-runs start from a known state. */
async function deleteSearchIfPresent(page: Page, name: string) {
  await page.goto("/saved/searches");

  // The list is fetched client-side, and `count()` does not auto-wait. Settle
  // on either a rendered row or the empty state first, or a fast `count()`
  // reports zero and the delete is silently skipped.
  await expect
    .poll(
      async () =>
        (await page.getByRole("link", { name: "View results" }).count()) > 0 ||
        (await page.getByText("You haven't saved any searches yet").count()) >
          0,
    )
    .toBe(true);

  const deleteButton = page.getByRole("button", {
    name: `Delete saved search ${name}`,
  });

  if (await deleteButton.count()) {
    await deleteButton.first().click();
    await expect(deleteButton).toHaveCount(0);
  }
}

test.describe("saved searches", () => {
  test("anonymous visitors are sent to login and keep their search", async ({
    page,
  }) => {
    await page.goto("/postings?q=zzqx-nothing-matches-this");

    await page.getByRole("button", { name: /save this search/i }).click();

    // The whole search has to survive the round trip, or the visitor comes
    // back to an empty browse page and has to retype it.
    await expect(page).toHaveURL(
      /\/login\?next=%2Fpostings%3Fq%3Dzzqx-nothing-matches-this/,
    );
  });

  test("the saved searches page invites anonymous visitors to log in", async ({
    page,
  }) => {
    await page.goto("/saved/searches");

    await expect(
      page.getByText("Sign in to see your saved searches"),
    ).toBeVisible();
    // Scoped to main: the header carries its own "Log in" link.
    await expect(
      page.getByRole("main").getByRole("link", { name: "Log in" }),
    ).toHaveAttribute("href", "/login?next=/saved/searches");
  });

  // A single sign-in covers every authenticated assertion: the login endpoint
  // is rate limited, and this suite shares that budget with the other specs.
  test("a renter can save a search that matches nothing, then manage it", async ({
    page,
  }) => {
    const searchTerm = `zzqx-e2e-${Date.now()}`;
    const derivedName = searchTerm;

    await login(page);
    const consoleErrors = collectConsoleErrors(page);

    // The empty result is the case the feature exists for: nothing matches
    // today, and without an alert there is no way to learn when something does.
    await page.goto(`/postings?q=${encodeURIComponent(searchTerm)}`);
    await expect(
      page.getByText(/No postings matched your search/),
    ).toBeVisible();

    await page.getByRole("button", { name: /save this search/i }).click();
    await expect(page.getByText(/search saved/i)).toBeVisible();

    // Saving the same filters again is a no-op, not an error the visitor sees.
    await page.reload();
    await page.getByRole("button", { name: /save this search/i }).click();
    await expect(page.getByText(/search saved/i)).toBeVisible();

    await page.goto("/saved");
    await page.getByRole("link", { name: "Searches" }).click();
    await expect(page).toHaveURL(/\/saved\/searches$/);

    // `exact` matters: the delete control's accessible name embeds the search
    // name, so a substring match resolves to two buttons.
    const row = page.getByRole("button", { name: derivedName, exact: true });
    await expect(row).toBeVisible();

    // Alert frequency round-trips through the API.
    const frequency = page.getByRole("combobox", { name: "Alerts" }).first();
    await frequency.selectOption("daily");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Alerts" }).first(),
    ).toHaveValue("daily");

    // "View results" reconstructs the original browse URL from the stored
    // filters, which is the whole point of keeping them.
    await page.getByRole("link", { name: "View results" }).first().click();
    await expect(page).toHaveURL(
      new RegExp(`q=${encodeURIComponent(searchTerm)}`),
    );

    await deleteSearchIfPresent(page, derivedName);
    await expect(
      page.getByRole("button", { name: derivedName, exact: true }),
    ).toHaveCount(0);

    // The duplicate save above is a deliberate 409, and the browser logs every
    // failed response to the console. Everything else must stay clean.
    expect(consoleErrors.filter((message) => !message.includes("409"))).toEqual(
      [],
    );
  });
});
