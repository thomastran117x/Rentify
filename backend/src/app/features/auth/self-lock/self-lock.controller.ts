import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import { parseRequestBody } from "@/configuration/validation/request";
import { asUuid } from "@/configuration/validation/uuid";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import { clearBrowserSessionCookies } from "@/features/auth/auth.response";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { selfLockRequestSchema } from "@/features/auth/self-lock/self-lock.model";
import type { SelfLockService } from "@/features/auth/self-lock/self-lock.service";

const LOCKED_MESSAGE =
  "Your account is locked. Reset your password to get back in.";

export class SelfLockController {
  constructor(
    private readonly selfLockService: SelfLockService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  /** Public: the emailed link is the only credential. */
  lockWithToken = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { token } = await parseRequestBody(request, selfLockRequestSchema);
    const result = await this.selfLockService.lockWithToken(
      token,
      toAuthAuditContext(request),
    );

    ok(response, result, { message: LOCKED_MESSAGE });
  };

  lockCurrentSession = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const result = await this.selfLockService.lockFromSession(
      asUuid(auth.sub),
      toAuthAuditContext(request),
    );

    clearBrowserSessionCookies(response);
    ok(response, result, { message: LOCKED_MESSAGE });
  };
}
