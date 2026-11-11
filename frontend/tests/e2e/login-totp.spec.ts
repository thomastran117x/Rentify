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
const TOTP_STEP_MS = 30_000;

/**
 * Seeded off auth.mfaBypassEmails, so its sign-in goes through the real login
 * MFA step once it has an authenticator. Every other seeded account skips it
 * locally.
 */
const ACCOUNT = {
  username: "totp-one",
  password: "Rentify123!",
  email: "totp1@rentify.local",
};

interface ApiSession {
  accessToken: string;
}

function authHeaders(session: ApiSession) {
  return { authorization: `Bearer ${session.accessToken}` };
}

/**
 * Sends once more after a 429. Setup, sign-in and cleanup together come close
 * to the per-account `auth-sensitive` budget and the emailed step-up code's
 * resend cooldown, so a run straight after another waits the window out.
 * `send` is called again, so anything time-based in it is recomputed.
 */
async function sendWaitingOutRateLimit(
  send: () => Promise<APIResponse>,
): Promise<APIResponse> {
  const response = await send();

  if (response.status() !== 429) {
    return response;
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: { details?: { retryAfterSeconds?: number } };
  };
  const retryAfterSeconds =
    Number(response.headers()["retry-after"]) ||
    body.error?.details?.retryAfterSeconds ||
    60;
  await new Promise((resolve) =>
    setTimeout(resolve, (retryAfterSeconds + 1) * 1000),
  );
  return send();
}

async function apiLogin(request: APIRequestContext): Promise<ApiSession> {
  const response = await sendWaitingOutRateLimit(() =>
    request.post(`${API_BASE}/auth/local/login`, {
      data: {
        username: ACCOUNT.username,
        password: ACCOUNT.password,
        captchaToken: "local-dev-bypass",
      },
    }),
  );

  expect(
    response.status(),
    "totp-one already has an authenticator; a previous run did not clean up. Re-seed the database.",
  ).toBe(200);
  const body = (await response.json()) as { data: { accessToken: string } };
  return { accessToken: body.data.accessToken };
}

/** The email-factor step-up, for an account with no authenticator yet. */
async function stepUp(request: APIRequestContext, session: ApiSession) {
  const challenge = await sendWaitingOutRateLimit(() =>
    request.post(`${API_BASE}/auth/mfa/verify/challenge`, {
      headers: authHeaders(session),
      data: { scope: "mfa-management", factor: "email" },
    }),
  );
  expect(challenge.ok(), `step-up challenge: ${challenge.status()}`).toBe(true);

  const preview = await request.get(
    `${API_BASE}/auth/mfa/verify/dev/otp?scope=mfa-management`,
    { headers: authHeaders(session) },
  );
  expect(preview.ok(), `step-up preview: ${preview.status()}`).toBe(true);
  const { code } = ((await preview.json()) as { data: { code: string } }).data;

  const confirm = await sendWaitingOutRateLimit(() =>
    request.post(`${API_BASE}/auth/mfa/verify/confirm`, {
      headers: authHeaders(session),
      data: { scope: "mfa-management", factor: "email", code },
    }),
  );
  expect(confirm.ok(), `step-up confirm: ${confirm.status()}`).toBe(true);
}

/**
 * The step-up an account needs once its authenticator is active, when email no
 * longer counts. Sign-in used the next time step, and replay protection refuses
 * anything but a newer one, so this waits for the step to turn over first.
 */
async function authenticatorStepUp(
  request: APIRequestContext,
  session: ApiSession,
  secret: string,
) {
  await new Promise((resolve) =>
    setTimeout(resolve, TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS) + 500),
  );

  const confirm = await sendWaitingOutRateLimit(() =>
    request.post(`${API_BASE}/auth/mfa/verify/confirm`, {
      headers: authHeaders(session),
      data: {
        scope: "mfa-management",
        factor: "totp",
        code: generateTotpCode(secret, Date.now() + TOTP_STEP_MS),
      },
    }),
  );
  expect(confirm.ok(), `step-up confirm: ${confirm.status()}`).toBe(true);
}

async function enrollAuthenticator(
  request: APIRequestContext,
  session: ApiSession,
): Promise<string> {
  await stepUp(request, session);

  const begin = await sendWaitingOutRateLimit(() =>
    request.post(`${API_BASE}/auth/mfa/totp/begin`, {
      headers: authHeaders(session),
      data: { accountName: ACCOUNT.email },
    }),
  );
  expect(begin.ok(), `enrollment begin: ${begin.status()}`).toBe(true);
  const { secret } = ((await begin.json()) as { data: { secret: string } })
    .data;

  const confirm = await sendWaitingOutRateLimit(() =>
    request.post(`${API_BASE}/auth/mfa/totp/confirm`, {
      headers: authHeaders(session),
      data: { code: generateTotpCode(secret) },
    }),
  );
  expect(confirm.ok(), `enrollment confirm: ${confirm.status()}`).toBe(true);

  return secret;
}

/**
 * A code for a time step newer than any used so far. Replay protection refuses
 * anything but a newer step, so this waits for the step to turn over and then
 * answers with the next one.
 */
async function nextUnusedCode(secret: string): Promise<string> {
  await new Promise((resolve) =>
    setTimeout(resolve, TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS) + 500),
  );
  return generateTotpCode(secret, Date.now() + TOTP_STEP_MS);
}

async function submitPassword(page: Page) {
  await page.goto("/login?next=%2Faccount");
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

let apiSession: ApiSession | null = null;
let enrolledSecret: string | null = null;

test.afterAll(async ({ playwright }) => {
  if (!apiSession) {
    return;
  }

  // The session that enrolled the authenticator is still valid; a fresh
  // step-up lets it remove the authenticator so the seed account stays
  // reusable however the test ended.
  const request = await playwright.request.newContext();
  try {
    if (enrolledSecret) {
      await authenticatorStepUp(request, apiSession, enrolledSecret);
    } else {
      await stepUp(request, apiSession);
    }
    const session = apiSession;
    const disabled = await sendWaitingOutRateLimit(() =>
      request.post(`${API_BASE}/auth/mfa/totp/disable`, {
        headers: authHeaders(session),
        data: {},
      }),
    );
    expect(disabled.ok(), `disable: ${disabled.status()}`).toBe(true);
  } finally {
    await request.dispose();
  }
});

test("signs in with a password and an authenticator code", async ({
  page,
  request,
}) => {
  apiSession = await apiLogin(request);
  const secret = await enrollAuthenticator(request, apiSession);
  enrolledSecret = secret;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/login?next=%2Faccount");
  await ensureCaptchaToken(page);
  await page
    .getByRole("textbox", { name: /^Username/i })
    .fill(ACCOUNT.username);
  await page.getByLabel(/^Password/i).fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The password checked out, but no session exists until the code does.
  const codeField = page.getByLabel("Authenticator code");
  await expect(codeField).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // A refresh comes back to the code step rather than the password form.
  await page.reload();
  await expect(page.getByLabel("Authenticator code")).toBeVisible();

  await page.getByLabel("Authenticator code").fill("000000");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(
    page.getByText(
      "That code is incorrect. Check your authenticator app and try again.",
    ),
  ).toBeVisible();

  // The enrollment used the current time step; the next one is newer and
  // still inside the verification window.
  await page
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(secret, Date.now() + 30_000));
  await page.getByRole("button", { name: "Verify and sign in" }).click();

  await page.waitForURL((url) => url.pathname === "/account", {
    timeout: 15_000,
  });
  // The code that signed in also covers the new-device check, so no second
  // verification dialog asks for it again.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(consoleErrors.filter((text) => !/401|400/.test(text))).toEqual([]);
});

test("remembers this device, then signs in again without a code", async ({
  page,
  request,
}) => {
  if (!apiSession || !enrolledSecret) {
    apiSession = await apiLogin(request);
    enrolledSecret = await enrollAuthenticator(request, apiSession);
  }
  const secret = enrolledSecret;
  const session = apiSession;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  // A first sign-in on this browser asks for the code, and offers to
  // remember the device.
  await submitPassword(page);
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  const remember = page.getByRole("checkbox", {
    name: "Remember this device for 30 days",
  });
  await expect(remember).not.toBeChecked();
  await remember.check();
  await page
    .getByLabel("Authenticator code")
    .fill(await nextUnusedCode(secret));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/account", {
    timeout: 15_000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Signed out and back in, the remembered browser skips the code step.
  await logOut(page);
  await submitPassword(page);
  await page.waitForURL((url) => url.pathname === "/account", {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Once the device is no longer trusted, its next sign-in asks again.
  await authenticatorStepUp(request, session, secret);
  const devices = await request.get(`${API_BASE}/auth/devices`, {
    headers: authHeaders(session),
  });
  expect(devices.ok(), `devices: ${devices.status()}`).toBe(true);
  const trusted = (
    (await devices.json()) as {
      data: { devices: Array<{ deviceId: string; trusted: boolean }> };
    }
  ).data.devices.filter((device) => device.trusted);
  expect(trusted).toHaveLength(1);
  const revoked = await request.delete(`${API_BASE}/auth/devices/trust`, {
    headers: authHeaders(session),
    data: { deviceId: trusted[0]!.deviceId },
  });
  expect(revoked.ok(), `revoke trust: ${revoked.status()}`).toBe(true);

  await logOut(page);
  await submitPassword(page);
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  expect(consoleErrors.filter((text) => !/401|400/.test(text))).toEqual([]);
});
