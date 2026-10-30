import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { ensureCaptchaToken } from "./helpers/auth";

const API_BASE = process.env.E2E_API_BASE_URL ?? "http://localhost:8040/api/v1";

const ACCOUNT = {
  username: "mod-one",
  password: "Rentify123!",
  email: "moderator1@rentify.local",
  changedEmail: "moderator1+e2e@rentify.local",
};

/** Another seeded account's address, used to prove the availability hint bites. */
const TAKEN_EMAIL = "owner1@rentify.local";

interface ApiSession {
  accessToken: string;
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/login?next=%2Faccount");
    await ensureCaptchaToken(page);
    await page
      .getByRole("textbox", { name: /^Username/i })
      .fill(ACCOUNT.username);
    await page.getByLabel(/^Password/i).fill(ACCOUNT.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    try {
      await page.waitForURL(/\/account/, { timeout: 15000 });
      return;
    } catch {
      // Fall through and try again.
    }
  }

  await expect(page).toHaveURL(/\/account/, { timeout: 15000 });
}

function authHeaders(session: ApiSession) {
  return { authorization: `Bearer ${session.accessToken}` };
}

/**
 * A second, API-only session for the same account.
 *
 * The pending-change record is keyed by user, so this session can read the code
 * the browser's request produced. The step-up proof, by contrast, is keyed by
 * session — which is why the restore below has to do its own step-up rather than
 * borrowing the browser's.
 */
async function apiLogin(request: APIRequestContext): Promise<ApiSession> {
  const response = await request.post(`${API_BASE}/auth/local/login`, {
    data: {
      username: ACCOUNT.username,
      password: ACCOUNT.password,
      captchaToken: "local-dev-bypass",
      rememberMe: false,
    },
  });

  expect(response.ok(), `login failed: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { data: { accessToken: string } };
  return { accessToken: body.data.accessToken };
}

async function readEmailChangeCode(
  request: APIRequestContext,
  session: ApiSession,
): Promise<string> {
  const response = await request.get(`${API_BASE}/auth/email/change/dev/otp`, {
    headers: authHeaders(session),
  });

  expect(
    response.ok(),
    `dev OTP preview failed: ${response.status()}`,
  ).toBeTruthy();
  const body = (await response.json()) as { data: { code: string } };
  return body.data.code;
}

async function completeApiStepUp(
  request: APIRequestContext,
  session: ApiSession,
) {
  const options = await request.get(
    `${API_BASE}/auth/mfa/verify/options?scope=mfa-management`,
    { headers: authHeaders(session) },
  );
  const optionsBody = (await options.json()) as {
    data?: { verified: boolean };
  };

  // Seeded addresses sit in MFA_BYPASS_EMAILS, so this is already satisfied
  // whenever the account is on its fixture address.
  if (optionsBody.data?.verified) {
    return;
  }

  const issueChallenge = () =>
    request.post(`${API_BASE}/auth/mfa/verify/challenge`, {
      headers: authHeaders(session),
      data: { scope: "mfa-management", factor: "email" },
    });

  let challenge = await issueChallenge();

  if (await waitOutRateLimit(challenge)) {
    challenge = await issueChallenge();
  }

  expect(
    challenge.ok(),
    `step-up challenge failed: ${challenge.status()}`,
  ).toBeTruthy();

  const preview = await request.get(
    `${API_BASE}/auth/mfa/verify/dev/otp?scope=mfa-management`,
    { headers: authHeaders(session) },
  );
  expect(
    preview.ok(),
    `step-up OTP preview failed: ${preview.status()}`,
  ).toBeTruthy();
  const previewBody = (await preview.json()) as { data: { code: string } };

  const confirm = await request.post(`${API_BASE}/auth/mfa/verify/confirm`, {
    headers: authHeaders(session),
    data: {
      scope: "mfa-management",
      factor: "email",
      code: previewBody.data.code,
    },
  });
  expect(
    confirm.ok(),
    `step-up confirm failed: ${confirm.status()}`,
  ).toBeTruthy();
}

/**
 * Sleeps out one rate-limit window. The restore below shares the per-user
 * `auth-sensitive` bucket with the test that just ran, so it can arrive to find
 * the budget already spent.
 */
async function waitOutRateLimit(response: {
  status: () => number;
  headers: () => Record<string, string>;
}): Promise<boolean> {
  if (response.status() !== 429) {
    return false;
  }

  const retryAfter = Number(response.headers()["retry-after"] ?? "60");
  await new Promise((resolve) =>
    setTimeout(resolve, (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000),
  );
  return true;
}

/**
 * Puts the seeded fixture back however the test ended, so a failure part-way
 * through does not leave the shared local database with a renamed account.
 *
 * Drives the real endpoints rather than writing to MySQL, which means it also
 * has to clear its own step-up: by the time this runs the account is off its
 * bypass-listed address.
 */
async function restoreSeededEmail(request: APIRequestContext) {
  const session = await apiLogin(request);

  await request.delete(`${API_BASE}/auth/email/change`, {
    headers: authHeaders(session),
  });

  await completeApiStepUp(request, session);

  const requested = await request.post(`${API_BASE}/auth/email/change`, {
    headers: authHeaders(session),
    data: { email: ACCOUNT.email },
  });

  // 400 is EMAIL_CHANGE_SAME_ADDRESS: already on the seeded address, so there
  // is nothing to undo.
  if (requested.status() === 400) {
    return;
  }

  expect(
    requested.ok(),
    `restore request failed: ${requested.status()}`,
  ).toBeTruthy();

  const code = await readEmailChangeCode(request, session);
  let confirmed = await request.post(`${API_BASE}/auth/email/change/confirm`, {
    headers: authHeaders(session),
    data: { code },
  });

  if (await waitOutRateLimit(confirmed)) {
    confirmed = await request.post(`${API_BASE}/auth/email/change/confirm`, {
      headers: authHeaders(session),
      data: { code },
    });
  }

  expect(
    confirmed.ok(),
    `restore confirm failed: ${confirmed.status()}`,
  ).toBeTruthy();
}

test.afterAll(async ({ playwright }) => {
  // The restore may have to sit out a full rate-limit window, which is longer
  // than the default hook timeout allows.
  test.setTimeout(180_000);

  const request = await playwright.request.newContext();
  try {
    await restoreSeededEmail(request);
  } finally {
    await request.dispose();
  }
});

test("a signed-in user changes their account email end to end", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    // Chromium logs "Failed to load resource" for every 4xx, and this test
    // deliberately provokes two: the taken-address probe and the wrong code.
    // Those are the API answering correctly, not a fault in the page.
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    ) {
      consoleErrors.push(message.text());
    }
  });

  await login(page);

  // The account starts on its seeded address, which MFA_BYPASS_EMAILS covers,
  // so the tab unlocks without a dialog.
  await page.getByRole("button", { name: /Security/i }).click();
  await expect(
    page.getByRole("heading", { name: "Email address" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("account-current-email")).toHaveText(
    ACCOUNT.email,
  );

  await page.getByRole("button", { name: "Change email" }).click();

  // Validation path: an address another account owns is reported before submit.
  await page.getByLabel("New email address").fill(TAKEN_EMAIL);
  await expect(page.getByText(/already in use/i)).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: "Send verification code" }),
  ).toBeDisabled();

  // Success path.
  await page.getByLabel("New email address").fill(ACCOUNT.changedEmail);
  await expect(
    page.getByRole("button", { name: "Send verification code" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send verification code" }).click();

  await expect(
    page.getByRole("button", { name: "Confirm new email" }),
  ).toBeVisible({ timeout: 15000 });

  const apiSession = await apiLogin(request);

  // A wrong code is rejected without ending the flow.
  await page.getByLabel(/Verification code sent to/).fill("000000");
  await page.getByRole("button", { name: "Confirm new email" }).click();
  await expect(page.getByText(/code is not right/i)).toBeVisible({
    timeout: 15000,
  });

  const code = await readEmailChangeCode(request, apiSession);
  await page.getByLabel(/Verification code sent to/).fill(code);
  await page.getByRole("button", { name: "Confirm new email" }).click();

  await expect(
    page.getByText(`Your email is now ${ACCOUNT.changedEmail}`),
  ).toBeVisible({ timeout: 15000 });

  // The session the confirm returned is adopted, so the panel re-renders with
  // the new address without a reload.
  await expect(page.getByTestId("account-current-email")).toHaveText(
    ACCOUNT.changedEmail,
  );

  /**
   * Persistence and the step-up gate, proved by one assertion.
   *
   * The account has just moved off its bypass-listed address, so after a reload
   * the Security tab stops auto-unlocking and demands verification. That prompt
   * appearing means two things at once: the new address survived the reload, and
   * the gate this feature depends on is genuinely enforced in the browser rather
   * than merely bypassed for seeded accounts.
   */
  await page.reload();
  await page.getByRole("button", { name: /Security/i }).click();

  const verify = page.getByRole("button", { name: "Verify to continue" });
  await expect(verify).toBeVisible({ timeout: 15000 });

  await verify.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
});
