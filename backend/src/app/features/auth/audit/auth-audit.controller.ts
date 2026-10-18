import type { Request, Response } from "express";
import { getQuery } from "@/configuration/http/request";
import { ok } from "@/configuration/http/responses";
import { parseRequestQuery } from "@/configuration/validation/request";
import { asUuid } from "@/configuration/validation/uuid";
import type { AuthAuditActivityService } from "@/features/auth/audit/auth-audit-activity.service";
import { listSecurityActivityQuerySchema } from "@/features/auth/audit/auth-audit.model";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export class AuthAuditController {
  constructor(
    private readonly activityService: AuthAuditActivityService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  /**
   * The caller's own security activity. The user id comes only from the
   * verified session; the strict query schema rejects anything else.
   */
  listMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const query = parseRequestQuery(
      getQuery(request),
      listSecurityActivityQuerySchema,
    );
    const result = await this.activityService.listForUser({
      ...query,
      userId: asUuid(auth.sub),
      sessionId: auth.sessionId,
    });
    ok(response, result);
  };
}
