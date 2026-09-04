import { expect, type Page } from "@playwright/test";

/**
 * Select an organization in the workspace switcher. Fixtures are worker-scoped
 * and specs sharing a worker share a session, so a spec that depends on a
 * particular active organization must set it explicitly rather than inheriting
 * whatever the previous spec left behind.
 */
export async function ensureActiveOrganization(page: Page, label: string) {
  const organizationSwitcher = page.getByRole("combobox", {
    name: "Active organization",
  });
  await expect(organizationSwitcher).toBeVisible();
  await organizationSwitcher.selectOption({ label });
}
