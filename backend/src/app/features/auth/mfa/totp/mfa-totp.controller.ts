import type { Request, Response } from "express";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import {
  beginEnrollmentRequestSchema,
  confirmEnrollmentRequestSchema,
  disableRequestSchema,
} from "./mfa-totp.model";
import type { MfaTotpService } from "./mfa-totp.service";
import type { Uuid } from "@/configuration/validation/uuid";

export class MfaTotpController {
  private readonly logger: Logger;

  constructor(
    private readonly mfaTotpService: MfaTotpService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {
    this.logger = loggerFactory.forClass(MfaTotpController, "controller");
  }

  getStatus = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const enabled = await this.mfaTotpService.isEnabled(auth.sub);
    ok(response, { enabled });
  };

  beginEnrollment = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(request, beginEnrollmentRequestSchema);
    const accountName = input.accountName ?? auth.email ?? auth.sub;
    const result = await this.mfaTotpService.beginEnrollment(
      auth.sub,
      accountName,
    );
    this.logMfaChangeEvent(
      request,
      auth.sub,
      auth.sessionId,
      "TOTP enrollment started",
    );
    ok(response, result);
  };

  confirmEnrollment = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(
      request,
      confirmEnrollmentRequestSchema,
    );
    await this.mfaTotpService.confirmEnrollment(auth.sub, input.code);
    this.logMfaChangeEvent(
      request,
      auth.sub,
      auth.sessionId,
      "TOTP enrollment confirmed",
    );
    ok(
      response,
      { confirmed: true as const },
      {
        message: "Authenticator app enabled.",
      },
    );
  };

  disable = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    await parseRequestBody(request, disableRequestSchema);
    await this.mfaTotpService.disable(auth.sub);
    this.logMfaChangeEvent(request, auth.sub, auth.sessionId, "TOTP disabled");
    ok(
      response,
      { disabled: true as const },
      {
        message: "Authenticator app disabled.",
      },
    );
  };

  cancelEnrollment = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    await this.mfaTotpService.cancelEnrollment(auth.sub);
    this.logMfaChangeEvent(
      request,
      auth.sub,
      auth.sessionId,
      "Pending TOTP enrollment cancelled",
    );
    ok(response, { cancelled: true as const });
  };

  private logMfaChangeEvent(
    request: Request,
    userId: Uuid,
    sessionId: string | undefined,
    message: string,
  ): void {
    this.logger.info(message, {
      userId,
      sessionId,
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "totp",
      ip: request.client.ip,
      userAgent: request.client.device.userAgent,
      timestamp: new Date().toISOString(),
      result: "success",
    });
  }
}
