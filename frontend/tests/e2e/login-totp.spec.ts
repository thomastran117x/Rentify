import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { ensureCaptchaToken } from "./helpers/auth";
import { generateTotpCode } from "./helpers/totp";

const API_BASE = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8040/api/v1";

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

/** The email-factor step-up that authenticator changes require. */
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

test.describe.configure({ mode: "serial", timeout: 180_000 });

let apiSession: ApiSession | null = null;

test.afterAll(async ({ playwright }) => {
  if (!apiSession) {
    return;
  }

  // The session that enrolled the authenticator is still valid; a fresh
  // step-up lets it remove the authenticator so the seed account stays
  // reusable however the test ended.
  const request = await playwright.request.newContext();
  try {
    await stepUp(request, apiSession);
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
