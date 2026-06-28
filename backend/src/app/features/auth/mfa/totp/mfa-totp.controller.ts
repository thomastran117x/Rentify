import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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

export class MfaTotpController {
  private readonly logger: Logger;

  constructor(
    private readonly mfaTotpService: MfaTotpService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {
    this.logger = loggerFactory.forClass(MfaTotpController, "controller");
  }

  getStatus = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireSessionAuth(context);
    const enabled = await this.mfaTotpService.isEnabled(auth.sub);
    return ok(context, { enabled });
  };

  beginEnrollment = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(context, beginEnrollmentRequestSchema);
    const accountName = input.accountName ?? auth.email ?? auth.sub;
    const result = await this.mfaTotpService.beginEnrollment(
      auth.sub,
      accountName,
    );
    this.logMfaChangeEvent(context, auth.sub, auth.sessionId, "TOTP enrollment started");
    return ok(context, result);
  };

  confirmEnrollment = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(
      context,
      confirmEnrollmentRequestSchema,
    );
    await this.mfaTotpService.confirmEnrollment(auth.sub, input.code);
    this.logMfaChangeEvent(context, auth.sub, auth.sessionId, "TOTP enrollment confirmed");
    return ok(
      context,
      { confirmed: true as const },
      {
        message: "Authenticator app enabled.",
      },
    );
  };

  disable = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    await parseRequestBody(context, disableRequestSchema);
    await this.mfaTotpService.disable(auth.sub);
    this.logMfaChangeEvent(context, auth.sub, auth.sessionId, "TOTP disabled");
    return ok(
      context,
      { disabled: true as const },
      {
        message: "Authenticator app disabled.",
      },
    );
  };

  cancelEnrollment = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await requireRecentMfaVerification(
      context,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    await this.mfaTotpService.cancelEnrollment(auth.sub);
    this.logMfaChangeEvent(context, auth.sub, auth.sessionId, "Pending TOTP enrollment cancelled");
    return ok(context, { cancelled: true as const });
  };

  private logMfaChangeEvent(
    context: Context<AppBindings>,
    userId: string,
    sessionId: string | undefined,
    message: string,
  ): void {
    this.logger.info(message, {
      userId,
      sessionId,
      scope: MFA_MANAGEMENT_SCOPE,
      factor: "totp",
      ip: context.get("client").ip,
      userAgent: context.get("client").device.userAgent,
      timestamp: new Date().toISOString(),
      result: "success",
    });
  }
}
