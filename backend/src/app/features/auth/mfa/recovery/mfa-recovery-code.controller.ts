import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import {
  MFA_DEVICE_LOGIN_SCOPE,
  MFA_MANAGEMENT_SCOPE,
} from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerificationForAnyScope } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import type { MfaRecoveryCodeService } from "./mfa-recovery-code.service";

export class MfaRecoveryCodeController {
  constructor(
    private readonly mfaRecoveryCodeService: MfaRecoveryCodeService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  getStatus = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    ok(response, await this.mfaRecoveryCodeService.getStatus(auth.sub));
  };

  /**
   * Also takes the `device-login` proof a sign-in leaves behind. Someone who
   * just spent their last code has no factor left to step up with, and this is
   * the only thing that proof unlocks beyond marking the device known.
   */
  regenerate = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireRecentMfaVerificationForAnyScope(
      request,
      this.mfaVerificationService,
      [MFA_DEVICE_LOGIN_SCOPE, MFA_MANAGEMENT_SCOPE],
    );
    const result = await this.mfaRecoveryCodeService.regenerate({
      userId: auth.sub,
      sessionId: auth.sessionId,
      context: toAuthAuditContext(request, auth.deviceId),
    });

    response.setHeader("cache-control", "no-store");
    ok(response, result, {
      message: "New recovery codes generated. The old ones no longer work.",
    });
  };
}
