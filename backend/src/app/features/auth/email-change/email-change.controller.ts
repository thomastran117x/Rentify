import type { Request, Response } from "express";
import { parseRequestBody } from "@/configuration/validation/request";
import { accepted, noContent, ok } from "@/configuration/http/responses";
import { asUuid } from "@/configuration/validation/uuid";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { writeAuthSessionResponse } from "@/features/auth/auth.response";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import type { EmailChangeService } from "@/features/auth/email-change/email-change.service";
import {
  confirmEmailChangeRequestSchema,
  requestEmailChangeRequestSchema,
} from "@/features/auth/email-change/email-change.model";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";

export class EmailChangeController {
  constructor(
    private readonly emailChangeService: EmailChangeService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  /**
   * The only handler behind the step-up gate. Every other handler in this file
   * operates on a pending record that could not exist unless this one ran first.
   */
  requestEmailChange = async (
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
      requestEmailChangeRequestSchema,
    );
    const result = await this.emailChangeService.requestChange({
      userId: asUuid(auth.sub),
      newEmail: input.email,
      client: request.client,
      deviceId: auth.deviceId ?? request.client.device.id,
    });
    accepted(response, result, {
      message: "Verification code sent to the new email address.",
    });
  };

  resendEmailChangeCode = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const result = await this.emailChangeService.resendCode({
      userId: asUuid(auth.sub),
      client: request.client,
      deviceId: auth.deviceId ?? request.client.device.id,
    });
    accepted(response, result, {
      message: "Verification code re-sent to the new email address.",
    });
  };

  confirmEmailChange = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const input = await parseRequestBody(
      request,
      confirmEmailChangeRequestSchema,
    );
    const result = await this.emailChangeService.confirmChange({
      userId: asUuid(auth.sub),
      code: input.code,
      client: request.client,
      deviceId: auth.deviceId ?? request.client.device.id,
      audit: toAuthAuditContext(
        request,
        auth.deviceId ?? request.client.device.id,
      ),
    });
    writeAuthSessionResponse(request, response, result, {
      message: "Email address changed successfully.",
    });
  };

  getPendingEmailChange = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const result = await this.emailChangeService.readPending(asUuid(auth.sub));
    ok(response, result);
  };

  cancelEmailChange = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    await this.emailChangeService.cancelChange(asUuid(auth.sub));
    noContent(response);
  };

  /**
   * Registered only outside production. Local and test environments suppress
   * delivery to `@rentify.local`, so seeded accounts have no inbox to read the
   * code from.
   */
  previewPendingEmailChangeOtp = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireSessionAuth(request);
    const result = await this.emailChangeService.previewPendingCode(
      asUuid(auth.sub),
    );

    if (!result) {
      throw new ResourceNotFoundError("No email change code is available.");
    }

    ok(response, result);
  };
}
