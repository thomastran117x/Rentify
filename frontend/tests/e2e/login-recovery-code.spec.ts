import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { ensureCaptchaToken } from "./helpers/auth";
import { generateTotpCode } from "./helpers/totp";

const API_BASE = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8040/api/v1";

/**
 * Seeded off auth.mfaBypassEmails, so every step here is the real one, and
 * kept apart from totp-one, which login-totp.spec.ts enrolls in parallel.
 */
const ACCOUNT = {
  username: "totp-two",
  password: "Rentify123!",
};

type Scope = "mfa-management" | "device-login";

/** Sends once more after a 429, waiting out the window it names. */
async function sendWaitingOutRateLimit(
  send: () => Promise<APIResponse>,
): Promise<APIResponse> {
  const response = await send();

  if (response.status() !== 429) {
    return response;
  }

  const retryAfterSeconds = Number(response.headers()["retry-after"]) || 60;
  await new Promise((resolve) =>
    setTimeout(resolve, (retryAfterSeconds + 1) * 1000),
  );
  return send();
}

/**
 * The browser sends its access token as a bearer header, and the dev-only OTP
 * preview needs that same session, so the latest one is kept here.
 */
function trackBearerToken(page: Page) {
  let authorization: string | null = null;

  page.on("request", (request) => {
    const header = request.headers().authorization;
    if (header?.startsWith("Bearer ") && request.url().startsWith(API_BASE)) {
      authorization = header;
    }
  });

  return () => {
    expect(authorization, "no authenticated request seen yet").not.toBeNull();
    return authorization!;
  };
}

/** Completes an emailed step-up in the open dialog, reading the code locally. */
async function completeEmailDialog(
  page: Page,
  request: APIRequestContext,
  authorization: () => string,
  scope: Scope,
) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Send code via email" }).click();
  await expect(dialog.getByPlaceholder("000000")).toBeVisible();

  const preview = await request.get(
    `${API_BASE}/auth/mfa/verify/dev/otp?scope=${scope}`,
    { headers: { authorization: authorization() } },
  );
  expect(preview.ok(), `OTP preview: ${preview.status()}`).toBe(true);
  const { code } = ((await preview.json()) as { data: { code: string } }).data;

  await dialog.getByPlaceholder("000000").fill(code);
  await dialog.getByRole("button", { name: /^verify$/i }).click();
  await expect(dialog).toHaveCount(0);
}

async function submitPassword(page: Page, nextPath: string) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
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

test.describe.configure({ mode: "serial", timeout: 240_000 });

let unusedCodes: string[] = [];

test.afterAll(async ({ playwright }) => {
  // Long enough to wait out the sign-in rate limit the test itself used up.
  test.setTimeout(150_000);

  if (unusedCodes.length < 2) {
    return;
  }

  // Signs in and steps up with two more codes, then removes the
  // authenticator, so the seeded account is reusable however the test ended.
  const request = await playwright.request.newContext();
  try {
    const first = await sendWaitingOutRateLimit(() =>
      request.post(`${API_BASE}/auth/local/login`, {
        data: {
          username: ACCOUNT.username,
          password: ACCOUNT.password,
          captchaToken: "local-dev-bypass",
          deviceId: "recovery-code-cleanup",
        },
      }),
    );
    const challenge = (
      (await first.json()) as {
        error: { details: { mfaChallengeToken: string } };
      }
    ).error.details.mfaChallengeToken;

    const second = await sendWaitingOutRateLimit(() =>
      request.post(`${API_BASE}/auth/login/mfa`, {
        data: {
          mfaChallengeToken: challenge,
          factor: "recovery_code",
          code: unusedCodes[0],
          deviceId: "recovery-code-cleanup",
        },
      }),
    );
    expect(second.ok(), `cleanup sign-in: ${second.status()}`).toBe(true);
    const { accessToken } = (
      (await second.json()) as { data: { accessToken: string } }
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

    const disabled = await request.post(`${API_BASE}/auth/mfa/totp/disable`, {
      headers,
      data: {},
    });
    expect(disabled.ok(), `cleanup disable: ${disabled.status()}`).toBe(true);
  } finally {
    await request.dispose();
  }
});

test("enrolls, signs out, and signs back in with a recovery code", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  const authorization = trackBearerToken(page);

  // Signing in with only a password; a new device asks for an emailed code.
  await submitPassword(page, "/account");
  const deviceDialog = page.getByRole("dialog");
  await Promise.race([
    page.waitForURL((url) => url.pathname === "/account"),
    deviceDialog.waitFor(),
  ]);
  if (await deviceDialog.isVisible()) {
    await completeEmailDialog(page, request, authorization, "device-login");
  }
  await page.waitForURL((url) => url.pathname === "/account");

  // The Security tab needs a step-up of its own.
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("button", { name: "Verify to continue" }).click();
  await completeEmailDialog(page, request, authorization, "mfa-management");

  // Enroll the authenticator.
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  const secretText = await page
    .locator("code")
    .filter({ hasText: /^[A-Z2-7 ]+$/ })
    .first()
    .textContent();
  const secret = (secretText ?? "").replace(/\s/g, "");
  expect(secret.length).toBeGreaterThan(10);
  await page
    .getByLabel(/Enter the 6-digit code shown in your app/)
    .fill(generateTotpCode(secret));
  await page.getByRole("button", { name: "Verify and enable" }).click();

  // The codes are shown once, with a way to keep them.
  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = (await list.getByRole("listitem").allTextContents()).map(
    (code) => code.trim(),
  );
  for (const code of codes) {
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  }
  unusedCodes = [...codes];

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("rentify-recovery-codes.txt");

  await page.getByRole("button", { name: "I've saved these codes" }).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByText("10 recovery codes left")).toBeVisible();

  // Sign out, and back in with a code instead of the authenticator.
  await logOut(page);
  await submitPassword(page, "/account");
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await page.getByRole("button", { name: "Use a recovery code" }).click();

  // Typed the way it might be read off paper.
  const code = codes[0]!;
  await page
    .getByLabel("Recovery code")
    .fill(code.toLowerCase().replace("-", ""));
  await expect(page.getByLabel("Recovery code")).toHaveValue(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/account", {
    timeout: 15_000,
  });
  unusedCodes = codes.slice(1);
  // The code that signed in also covers the new-device check.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The same code does not work twice.
  await logOut(page);
  await submitPassword(page, "/account");
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByText(/incorrect or was already used/i)).toBeVisible();

  expect(consoleErrors.filter((text) => !/401|400/.test(text))).toEqual([]);
});
