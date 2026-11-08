import { buildApiPath } from "@/configuration/http/api-path";

interface StepUpApp {
  request(url: string, init?: RequestInit): Response | Promise<Response>;
}

type StepUpScope = "mfa-management" | "device-login";

function apiUrl(path: string): string {
  return `http://rent.test${buildApiPath(path)}`;
}

async function confirmStepUp(
  app: StepUpApp,
  headers: Record<string, string>,
  body: {
    scope: StepUpScope;
    factor: "email" | "totp" | "recovery_code";
    code: string;
  },
): Promise<void> {
  const response = await app.request(apiUrl("/auth/mfa/verify/confirm"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    data: { verified: true, scope: body.scope },
  });
}

/**
 * Completes an email-factor step-up. Verification is bound to the session, so
 * every newly issued session needs its own before a guarded action.
 */
export async function completeEmailStepUp(
  app: StepUpApp,
  headers: Record<string, string>,
  scope: StepUpScope = "mfa-management",
): Promise<void> {
  const challenge = await app.request(apiUrl("/auth/mfa/verify/challenge"), {
    method: "POST",
    headers,
    body: JSON.stringify({ scope, factor: "email" }),
  });
  expect(challenge.status).toBe(200);

  const preview = await app.request(
    apiUrl(`/auth/mfa/verify/dev/otp?scope=${scope}`),
    { headers },
  );
  expect(preview.status).toBe(200);
  const { data } = (await preview.json()) as { data: { code: string } };

  await confirmStepUp(app, headers, {
    scope,
    factor: "email",
    code: data.code,
  });
}

/** The way back in for an account whose authenticator is gone. */
export async function completeRecoveryCodeStepUp(
  app: StepUpApp,
  headers: Record<string, string>,
  code: string,
  scope: StepUpScope = "mfa-management",
): Promise<void> {
  await confirmStepUp(app, headers, { scope, factor: "recovery_code", code });
}

/** The step-up an account with an active authenticator has to use instead. */
export async function completeTotpStepUp(
  app: StepUpApp,
  headers: Record<string, string>,
  code: string,
  scope: StepUpScope = "mfa-management",
): Promise<void> {
  await confirmStepUp(app, headers, { scope, factor: "totp", code });
}
