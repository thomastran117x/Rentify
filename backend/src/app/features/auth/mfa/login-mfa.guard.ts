import { loggerFactory } from "@/configuration/logging";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { isMfaBypassEligible } from "@/features/auth/mfa/mfa-bypass";
import { redactEmail } from "@/features/auth/redact-email";
import type { Uuid } from "@/configuration/validation/uuid";

const logger = loggerFactory.forComponent("auth.login-mfa", "service");

/**
 * Login-time second factor. Distinct from
 * {@link import("@/features/auth/mfa/verification/mfa-verification.guard").requireRecentMfaVerification},
 * which re-checks an already-authenticated session before a sensitive action.
 */
export async function requireLoginMfa(
  mfaTotpService: MfaTotpService,
  userId: Uuid,
  email: string,
  totpCode: string | undefined,
): Promise<void> {
  if (isMfaBypassEligible(email)) {
    logger.info("MFA bypass used", {
      userId,
      email: redactEmail(email),
      result: "bypass",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const mfaEnabled = await mfaTotpService.isEnabled(userId);

  if (!mfaEnabled) {
    return;
  }

  if (!totpCode) {
    throw new UnauthorizedError("Authenticator code is required.", {
      mfaRequired: true,
    });
  }

  await mfaTotpService.verifyCode(userId, totpCode);
}
