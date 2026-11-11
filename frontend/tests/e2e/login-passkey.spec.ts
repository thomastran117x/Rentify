import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { ensureCaptchaToken } from "./helpers/auth";

const API_BASE = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8040/api/v1";

/**
 * Passkeys belong to the RP ID `localhost`, and a browser will not use one
 * from `127.0.0.1`, so this spec opens the app by name whatever the base URL.
 */
const APP_ORIGIN = (
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3040"
).replace("//127.0.0.1:", "//localhost:");

/** Seeded off auth.mfaBypassEmails, and with no second factor to start with. */
const ACCOUNT = {
  username: "passkey-one",
  password: "Rentify123!",
};

type Scope = "mfa-management" | "device-login";

interface Harness {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  authorization: () => string;
}

/**
 * A browser context with a CTAP2 platform authenticator that always verifies
 * the user, so passkey prompts finish without a person present.
 */
async function createHarness(browser: Browser): Promise<Harness> {
  const context = await browser.newContext({ baseURL: APP_ORIGIN });

  // Some machines resolve localhost to a relay that resets connections; the
  // stack itself listens on the IPv4 loopback, so send the traffic there.
  await context.route(/^http:\/\/localhost:(3040|8040)\//, async (route) => {
    const request = route.request();
    const response = await route.fetch({
      url: request.url().replace("//localhost:", "//127.0.0.1:"),
      headers: await request.allHeaders(),
    });
    await route.fulfill({ response });
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  let authorization: string | null = null;
  page.on("request", (request) => {
    const header = request.headers().authorization;
    if (header?.startsWith("Bearer ") && request.url().includes("/api/v1/")) {
      authorization = header;
    }
  });

  return {
    context,
    page,
    cdp,
    authorization: () => {
      expect(authorization, "no authenticated request seen yet").not.toBeNull();
      return authorization!;
    },
  };
}

/** Completes an emailed step-up in the open dialog, reading the code locally. */
async function completeEmailDialog(
  harness: Harness,
  request: APIRequestContext,
  scope: Scope,
) {
  const dialog = harness.page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Send code via email" }).click();
  await expect(dialog.getByPlaceholder("000000")).toBeVisible();

  const preview = await request.get(
    `${API_BASE}/auth/mfa/verify/dev/otp?scope=${scope}`,
    { headers: { authorization: harness.authorization() } },
  );
  expect(preview.ok(), `OTP preview: ${preview.status()}`).toBe(true);
  const { code } = ((await preview.json()) as { data: { code: string } }).data;

  await dialog.getByPlaceholder("000000").fill(code);
  await dialog.getByRole("button", { name: /^verify$/i }).click();
  await expect(dialog).toHaveCount(0);
}

async function submitPassword(page: Page) {
  await page.goto(`/login?next=${encodeURIComponent("/account")}`);
  await ensureCaptchaToken(page);
  await page
    .getByRole("textbox", { name: /^Username/i })
    .fill(ACCOUNT.username);
  await page.getByLabel(/^Password/i).fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function logOut(page: Page) {
  await page.locator('[aria-label$="account menu"]').click();
  await Promise.all([
    page.waitForURL("**/login**"),
    page.getByRole("button", { name: "Log out", exact: true }).click(),
  ]);
}

async function openSecurityTab(page: Page) {
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("button", { name: "Verify to continue" }).click();
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

let harness: Harness | null = null;
/** The account's recovery codes, kept so cleanup can sign in without the passkey. */
let unusedCodes: string[] = [];

/**
 * Removes every passkey the account has, through the API with two of its
 * recovery codes, so the seeded account starts the next run without a factor
 * however this one ended. The passkey cannot help here: its private key goes
 * with the virtual authenticator.
 */
async function removeLeftoverPasskeys(request: APIRequestContext) {
  const deviceId = "passkey-spec-cleanup";
  const first = await request.post(`${API_BASE}/auth/local/login`, {
    data: {
      username: ACCOUNT.username,
      password: ACCOUNT.password,
      captchaToken: "local-dev-bypass",
      deviceId,
    },
  });

  if (first.ok()) {
    // No second factor left: nothing to remove.
    return;
  }

  const { mfaChallengeToken } = (
    (await first.json()) as {
      error: { details: { mfaChallengeToken: string } };
    }
  ).error.details;
  const signIn = await request.post(`${API_BASE}/auth/login/mfa`, {
    data: {
      mfaChallengeToken,
      factor: "recovery_code",
      code: unusedCodes[0],
      deviceId,
    },
  });
  expect(signIn.ok(), `cleanup sign-in: ${signIn.status()}`).toBe(true);
  const { accessToken } = (
    (await signIn.json()) as {
      data: { accessToken: string };
    }
  ).data;
  const headers = { authorization: `Bearer ${accessToken}` };

  const stepUp = await request.post(`${API_BASE}/auth/mfa/verify/confirm`, {
    headers,
    data: {
      scope: "mfa-management",
      factor: "recovery_code",
      code: unusedCodes[1],
    },
  });
  expect(stepUp.ok(), `cleanup step-up: ${stepUp.status()}`).toBe(true);

  const list = await request.get(`${API_BASE}/auth/mfa/passkeys`, { headers });
  const { passkeys } = (
    (await list.json()) as {
      data: { passkeys: { id: string }[] };
    }
  ).data;
  for (const passkey of passkeys) {
    const removed = await request.delete(
      `${API_BASE}/auth/mfa/passkeys/${passkey.id}`,
      { headers },
    );
    expect(removed.status(), "cleanup removal").toBe(204);
  }
}

test.afterAll(async ({ playwright }) => {
  await harness?.context.close();

  if (unusedCodes.length < 2) {
    return;
  }

  const request = await playwright.request.newContext();
  try {
    await removeLeftoverPasskeys(request);
  } finally {
    await request.dispose();
  }
});

test("adds a passkey, signs in and steps up with it, then removes it", async ({
  browser,
  request,
}) => {
  harness = await createHarness(browser);
  const { page } = harness;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  // No second factor yet: the password alone signs in, and a new device is
  // checked by email.
  await submitPassword(page);
  const deviceDialog = page.getByRole("dialog");
  await Promise.race([
    page.waitForURL((url) => url.pathname === "/account"),
    deviceDialog.waitFor(),
  ]);
  if (await deviceDialog.isVisible()) {
    await completeEmailDialog(harness, request, "device-login");
  }
  await page.waitForURL((url) => url.pathname === "/account");

  await openSecurityTab(page);
  await completeEmailDialog(harness, request, "mfa-management");

  // Add a passkey; the first one comes with the account's recovery codes.
  const panel = page.getByRole("region", { name: "Passkeys" });
  await expect(panel.getByText(/no passkeys yet/i)).toBeVisible();
  await panel.getByRole("button", { name: "Add a passkey" }).click();
  await panel.getByLabel("Name this passkey").fill("Virtual laptop");
  await panel.getByRole("button", { name: "Continue" }).click();

  const codes = page.getByRole("list", { name: "Recovery codes" });
  await expect(codes.getByRole("listitem")).toHaveCount(10);
  unusedCodes = (await codes.getByRole("listitem").allTextContents()).map(
    (code) => code.trim(),
  );
  await page.getByRole("button", { name: "I've saved these codes" }).click();
  await expect(
    panel.getByText("Virtual laptop", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("10 recovery codes left")).toBeVisible();

  // Rename it; adding the first passkey changed the factors, so this asks
  // for a step-up, which the passkey itself answers.
  await panel.getByRole("button", { name: "Rename Virtual laptop" }).click();
  await panel.getByLabel("Passkey name").fill("Desk key");
  await panel.getByRole("button", { name: "Save" }).click();
  const renameDialog = page.getByRole("dialog");
  await expect(
    renameDialog.getByRole("button", { name: "Use passkey" }),
  ).toBeVisible();
  await renameDialog.getByRole("button", { name: "Use passkey" }).click();
  await expect(renameDialog).toHaveCount(0);
  await expect(panel.getByText("Desk key", { exact: true })).toBeVisible();

  // Sign out, and back in with the passkey instead of a code.
  await logOut(page);
  await submitPassword(page);
  await expect(page.getByText("Use your passkey")).toBeVisible();
  await page.getByRole("button", { name: "Use passkey" }).click();
  await page.waitForURL((url) => url.pathname === "/account", {
    timeout: 15_000,
  });
  // The passkey that signed in also covers the new-device check.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The Security tab's step-up starts on the passkey too.
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("button", { name: "Verify to continue" }).click();
  const stepUp = page.getByRole("dialog");
  await stepUp.getByRole("button", { name: "Use passkey" }).click();
  await expect(stepUp).toHaveCount(0);
  await expect(panel.getByText(/Last used/)).toBeVisible();

  // Removing the last strong factor warns first.
  await panel.getByRole("button", { name: "Remove Desk key" }).click();
  await expect(
    panel.getByRole("alertdialog", { name: "Remove Desk key?" }),
  ).toContainText("signs out your other sessions");
  await panel.getByRole("button", { name: "Remove passkey" }).click();
  await expect(panel.getByRole("status")).toContainText(
    /other sessions were signed out/i,
  );
  await expect(panel.getByText(/no passkeys yet/i)).toBeVisible();
  await expect(page.getByText(/recovery codes left/)).toHaveCount(0);
  // Removing it deleted the codes, so there is nothing left to clean up.
  unusedCodes = [];

  expect(consoleErrors.filter((text) => !/401|400/.test(text))).toEqual([]);
});
