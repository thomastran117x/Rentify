import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { SEEDED_USERS, login } from "./auth";

/**
 * Refresh tokens are single-use and rotate on every /auth/refresh call, with
 * only a 5s grace period for reuse (backend/src/app/features/auth/token/token.service.ts).
 * A new browser context has no in-memory access token, so loading a *saved*
 * session (e.g. storageState written to disk) forces an immediate refresh —
 * any second consumer of that same saved session more than 5s later presents
 * an already-consumed token and gets its whole session revoked. To avoid
 * that, each role logs in once per worker and keeps using the same live
 * context/page for the rest of that worker's tests, so the context's own
 * cookie jar always holds the latest rotated token instead of a stale copy.
 */
interface AuthFixtures {
  ownerPage: Page;
  managerPage: Page;
  operatorPage: Page;
}

async function createAuthenticatedPage(
  browser: import("@playwright/test").Browser,
  username: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, username);
  return { page, close: () => context.close() };
}

export const test = base.extend<object, AuthFixtures>({
  ownerPage: [
    async ({ browser }, use) => {
      const { page, close } = await createAuthenticatedPage(
        browser,
        SEEDED_USERS["owner-one"].username,
      );
      await use(page);
      await close();
    },
    { scope: "worker" },
  ],
  managerPage: [
    async ({ browser }, use) => {
      const { page, close } = await createAuthenticatedPage(
        browser,
        SEEDED_USERS["renter-one"].username,
      );
      await use(page);
      await close();
    },
    { scope: "worker" },
  ],
  operatorPage: [
    async ({ browser }, use) => {
      const { page, close } = await createAuthenticatedPage(
        browser,
        SEEDED_USERS["renter-two"].username,
      );
      await use(page);
      await close();
    },
    { scope: "worker" },
  ],
});

export { expect };
