import { loggerFactory } from "@/configuration/logging";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { isMfaBypassEligible } from "@/features/auth/mfa/mfa-bypass";
import { redactEmail } from "@/features/auth/redact-email";
import type { Uuid } from "@/configuration/validation/uuid";

const logger = loggerFactory.forComponent("auth.login-mfa", "service");

/**
 * `"challenge"` means the first step succeeded but the account needs a second
 * factor, which the caller asks for through a login MFA challenge.
 */
export type LoginMfaEvaluation = "satisfied" | "challenge";

/**
 * Login-time second factor. Distinct from
 * {@link import("@/features/auth/mfa/verification/mfa-verification.guard").requireRecentMfaVerification},
 * which re-checks an already-authenticated session before a sensitive action.
 *
 * `totpCode` is the deprecated one-request form, kept for API clients that send
 * the code with the password. A wrong one throws; web clients send none and
 * finish through `POST /auth/login/mfa` instead.
 */
export async function evaluateLoginMfa(
  mfaTotpService: MfaTotpService,
  userId: Uuid,
  email: string,
  totpCode: string | undefined,
): Promise<LoginMfaEvaluation> {
  if (isMfaBypassEligible(email)) {
    logger.info("MFA bypass used", {
      userId,
      email: redactEmail(email),
      result: "bypass",
      timestamp: new Date().toISOString(),
    });
    return "satisfied";
  }

  const mfaEnabled = await mfaTotpService.isEnabled(userId);

  if (!mfaEnabled) {
    return "satisfied";
  }

  if (!totpCode) {
    return "challenge";
  }

  await mfaTotpService.verifyCode(userId, totpCode);
  return "satisfied";
}
