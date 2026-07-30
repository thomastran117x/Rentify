import { expect, test, type Page } from "@playwright/test";

// Read-only assertions run against organization one, which is never renamed.
const MANAGER_USERNAME = "renter-one";
const PASSWORD = "Rentify123!";
const ORGANIZATION_NAME = "Maya Santos Organization";
const ORGANIZATION_SLUG = "maya-santos-organization";
const ORGANIZATION_UUID = "00000000-0000-0000-1040-000000000001";

// Renames are destructive and permanent -- a retired slug can never be reused,
// so the mutating tests use a separate organization and a fresh slug each run,
// and never assert a hardcoded starting slug for it.
const RENAME_OWNER_USERNAME = "owner-two";
const RENAME_ORGANIZATION_NAME = "Elliot Chen Organization";

// Slug edits mutate shared seed state, so these must not interleave.
test.describe.configure({ mode: "serial" });

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

  const token = await readCaptchaToken();

  if (!token) {
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

async function submitLogin(page: Page, username: string, nextPath: string) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await ensureCaptchaToken(page);
  await page.getByRole("textbox", { name: /^Username/i }).fill(username);
  await page.getByLabel(/^Password/i).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Sign in and land on the dashboard.
 *
 * Retried because back-to-back sign-ins occasionally return a 200 from the API
 * without the browser session settling, leaving the page back on /login. That
 * flake is in the auth handshake, not in anything these tests assert.
 */
async function login(
  page: Page,
  username: string,
  nextPath = "/dashboard/organizations",
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await submitLogin(page, username, nextPath);

    try {
      await page.waitForURL(/\/dashboard\/organizations/, { timeout: 15000 });
      return;
    } catch {
      // Fall through and try again.
    }
  }

  await expect(page).toHaveURL(/\/dashboard\/organizations/, {
    timeout: 15000,
  });
}

function sidebarLink(page: Page, name: RegExp) {
  return page
    .getByRole("navigation", { name: "Organization workspace sections" })
    .getByRole("link", { name });
}

function slugField(page: Page) {
  return page.getByRole("textbox", { name: "Organization URL slug" });
}

// Scoped to the field's own error element: a bare text match would also hit
// the footer's "All rights reserved."
function slugError(page: Page) {
  return page.locator("#organization-slug-error");
}

/**
 * Reach the workspace Settings panel.
 *
 * The active organization comes from session state, not the URL, so it has to
 * be selected in the switcher before the workspace detail (and therefore the
 * slug field) exists.
 */
async function selectActiveOrganization(
  page: Page,
  organizationName: string,
  roleLabel: string,
) {
  const organizationSwitcher = page.getByRole("combobox", {
    name: "Active organization",
  });
  await expect(organizationSwitcher).toBeVisible({ timeout: 30000 });
  await organizationSwitcher.selectOption({
    label: `${organizationName} - ${roleLabel}`,
  });
  await expect(page).toHaveURL(/\/dashboard\/organizations\/overview$/);
}

/**
 * Open Settings as a role that is allowed to see it.
 *
 * Selecting an organization kicks off a session refresh and a workspace
 * refetch; until that lands the panel has no detail, so wait for the card.
 */
async function openSettingsPanel(
  page: Page,
  organizationName: string,
  roleLabel: string,
) {
  await selectActiveOrganization(page, organizationName, roleLabel);

  // Navigate by clicking the sidebar rather than page.goto(): a hard
  // navigation right after the switcher's token refresh can land before the
  // session is re-established and bounce to /login.
  await sidebarLink(page, /Settings/).click();
  await expect(page).toHaveURL(/\/dashboard\/organizations\/settings$/);

  await expect(
    page.getByRole("heading", { name: "Organization profile" }),
  ).toBeVisible({ timeout: 30000 });
}

test("the organization directory links to slug URLs", async ({ page }) => {
  await page.goto("/organizations");

  await page.getByRole("link", { name: "View organization" }).first().click();

  await expect(page).toHaveURL(/\/organizations\/[a-z0-9-]+$/);
  await expect(page).not.toHaveURL(/\/organizations\/[0-9a-f]{8}-[0-9a-f]{4}/);
});

test("a UUID URL redirects to the canonical slug with 307", async ({
  request,
}) => {
  // 307 rather than 308: the UUID's canonical target moves whenever the slug
  // is edited, so a cached permanent redirect would go stale.
  const response = await request.get(`/organizations/${ORGANIZATION_UUID}`, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain(
    `/organizations/${ORGANIZATION_SLUG}`,
  );
});

test("a UUID blog URL redirects to the canonical slug", async ({ page }) => {
  await page.goto(`/organizations/${ORGANIZATION_UUID}/blog`);

  await expect(page).toHaveURL(
    new RegExp(`/organizations/${ORGANIZATION_SLUG}/blog$`),
  );
});

test("a non-canonical reference redirects to the canonical slug", async ({
  request,
}) => {
  const response = await request.get(
    `/organizations/${ORGANIZATION_SLUG.toUpperCase()}`,
    { maxRedirects: 0 },
  );

  expect([307, 308]).toContain(response.status());
  expect(response.headers().location).toContain(
    `/organizations/${ORGANIZATION_SLUG}`,
  );
});

test("the organization page renders at its slug URL with a canonical link", async ({
  page,
}) => {
  await page.goto(`/organizations/${ORGANIZATION_SLUG}`);

  await expect(
    page.getByRole("heading", { name: ORGANIZATION_NAME }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `/organizations/${ORGANIZATION_SLUG}`,
  );
});

test("an unknown slug returns a real 404 without a failed API call", async ({
  page,
  request,
}) => {
  const response = await request.get(
    "/organizations/no-such-organization-exists",
    {
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBe(404);

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/organizations/no-such-organization-exists");

  await expect(
    page.getByRole("heading", { name: /could not be found/i }),
  ).toBeVisible();

  // The 404 document itself is logged by the browser, which is inherent to a
  // real 404. What must not appear is a 400: that would mean the unresolvable
  // reference was forwarded to the UUID-only detail endpoint.
  expect(consoleErrors.filter((entry) => entry.includes("400"))).toEqual([]);
});

test("a manager cannot change the organization URL", async ({ page }) => {
  await login(page, MANAGER_USERNAME);
  await selectActiveOrganization(page, ORGANIZATION_NAME, "Manager");

  // Managers are not offered Settings at all, and forcing the route lands them
  // back on overview.
  await expect(sidebarLink(page, /Settings/)).toHaveCount(0);
  await expect(slugField(page)).toHaveCount(0);
});

test("the primary manager changes the URL and the old one keeps resolving", async ({
  page,
}) => {
  // Scoped to this feature's own requests. The login screen's captcha widget
  // has no site key in the local stack, so it logs an unrelated 400 that
  // affects every spec touching sign-in.
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      (text.includes("/organizations") || text.includes("/api/v1"))
    ) {
      consoleErrors.push(text);
    }
  });

  await login(page, RENAME_OWNER_USERNAME);
  await openSettingsPanel(page, RENAME_ORGANIZATION_NAME, "Primary Manager");

  const field = slugField(page);
  await expect(field).toBeVisible();

  // Read the current slug rather than hardcoding one: earlier runs have already
  // renamed this organization, and retired slugs are never reused.
  const previousSlug = await field.inputValue();
  expect(previousSlug).not.toBe("");

  // Invalid input is rejected inline and offers no way to submit.
  await field.fill("Not A Slug");
  await expect(slugError(page)).toHaveText(/only contain lowercase/i);
  await expect(page.getByRole("button", { name: "Change URL" })).toHaveCount(0);

  // A reserved slug is rejected too.
  await field.fill("invitations");
  await expect(slugError(page)).toHaveText(/reserved/i);
  await expect(page.getByRole("button", { name: "Change URL" })).toHaveCount(0);

  const newSlug = `elliot-chen-${Date.now()}`;
  await field.fill(newSlug);
  await page.getByRole("button", { name: "Change URL" }).click();

  // The change is destructive enough to require confirmation.
  await expect(page.getByText(/will redirect existing links/i)).toBeVisible();
  await page.getByRole("button", { name: /Confirm new URL/ }).click();

  await expect(field).toHaveValue(newSlug);

  // The new URL serves the page.
  await page.goto(`/organizations/${newSlug}`);
  await expect(
    page.getByRole("heading", { name: RENAME_ORGANIZATION_NAME }),
  ).toBeVisible();

  // The retired slug still resolves, redirecting to the new one.
  await page.goto(`/organizations/${previousSlug}`);
  await expect(page).toHaveURL(new RegExp(`/organizations/${newSlug}$`));
  await expect(
    page.getByRole("heading", { name: RENAME_ORGANIZATION_NAME }),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("a retired slug redirects permanently with 308 and cannot be reused", async ({
  page,
  request,
}) => {
  await login(page, RENAME_OWNER_USERNAME);
  await openSettingsPanel(page, RENAME_ORGANIZATION_NAME, "Primary Manager");

  const field = slugField(page);
  await expect(field).toBeVisible();

  async function renameTo(slug: string) {
    await field.fill(slug);
    await page.getByRole("button", { name: "Change URL" }).click();
    await page.getByRole("button", { name: /Confirm new URL/ }).click();
    await expect(field).toHaveValue(slug);
  }

  // Rename twice so the slug under test was never rendered as a page: Next
  // caches a rendered route, which would serve a stale 200 instead of the
  // redirect.
  const retiredSlug = `elliot-chen-${Date.now()}-a`;
  const currentSlug = `elliot-chen-${Date.now()}-b`;
  await renameTo(retiredSlug);
  await renameTo(currentSlug);

  // 308 rather than 307: aliases are permanent, so the target cannot change
  // out from under a cached redirect.
  const response = await request.get(`/organizations/${retiredSlug}`, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(308);
  expect(response.headers().location).toContain(
    `/organizations/${currentSlug}`,
  );

  // Re-adopting the retired slug is refused: that is what keeps the permanent
  // redirect above from ever pointing somewhere else.
  await field.fill(retiredSlug);
  await page.getByRole("button", { name: "Change URL" }).click();
  await page.getByRole("button", { name: /Confirm new URL/ }).click();

  await expect(page.getByText(/already taken/i).first()).toBeVisible();
  await expect(field).toHaveValue(currentSlug);
});
