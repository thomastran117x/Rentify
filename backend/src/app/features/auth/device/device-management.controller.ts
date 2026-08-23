import type { Request, Response } from "express";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { ok } from "@/configuration/http/responses";
import { toRemoveKnownDeviceInput } from "@/features/auth/auth.request-mappers";
import { DeviceManagementService } from "@/features/auth/device/device-management.service";
import { removeKnownDeviceRequestSchema } from "@/features/auth/device/device-management.model";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import { requireRecentMfaVerification } from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export class DeviceManagementController {
  constructor(
    private readonly deviceManagementService: DeviceManagementService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  deviceVerify = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.deviceManagementService.deviceVerify({
      auth: request.auth,
      client: request.client,
    });
    ok(response, result, {
      message: "Device verified successfully.",
    });
  };

  devices = async (request: Request, response: Response): Promise<void> => {
    await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const result = await this.deviceManagementService.devices({
      auth: request.auth,
      client: request.client,
    });
    ok(response, result);
  };

  removeKnownDevice = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireRecentMfaVerification(
      request,
      this.mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    const input = await parseRequestBody(
      request,
      removeKnownDeviceRequestSchema,
    );
    const result = await this.deviceManagementService.removeKnownDevice(
      toRemoveKnownDeviceInput(request, input),
    );
    ok(response, result, {
      message: "Known device removed successfully.",
    });
  };
}
