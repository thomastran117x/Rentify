import { expect, test as setup } from "@playwright/test";
import { DEFAULT_SEEDED_ROLES, SEEDED_USERS, authFile, login } from "./helpers/auth";

for (const role of DEFAULT_SEEDED_ROLES) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await login(page, SEEDED_USERS[role].username);
    await expect(page).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: authFile(role) });
  });
}
