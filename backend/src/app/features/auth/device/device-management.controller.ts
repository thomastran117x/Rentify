import type { Request, Response } from "express";
import { parseRequestBody } from "@/configuration/validation/request";
import { ok } from "@/configuration/http/responses";
import { toRemoveKnownDeviceInput } from "@/features/auth/auth.request-mappers";
import { DeviceManagementService } from "@/features/auth/device/device-management.service";
import { removeKnownDeviceRequestSchema } from "@/features/auth/device/device-management.model";
import {
  MFA_DEVICE_LOGIN_SCOPE,
  MFA_MANAGEMENT_SCOPE,
} from "@/features/auth/mfa/verification/mfa-verification.model";
import {
  requireRecentMfaVerification,
  requireRecentMfaVerificationForAnyScope,
} from "@/features/auth/mfa/verification/mfa-verification.guard";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export class DeviceManagementController {
  constructor(
    private readonly deviceManagementService: DeviceManagementService,
    private readonly mfaVerificationService: MfaVerificationService,
  ) {}

  /**
   * Trusting a device silences its new-device alerts, so a stolen session or
   * password must not be enough. Sign-in reaches this with the `device-login`
   * proof from its new-device check; anything later needs `mfa-management`.
   */
  deviceVerify = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireRecentMfaVerificationForAnyScope(
      request,
      this.mfaVerificationService,
      [MFA_DEVICE_LOGIN_SCOPE, MFA_MANAGEMENT_SCOPE],
    );
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

  revokeDeviceTrust = async (
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
    const result = await this.deviceManagementService.revokeDeviceTrust(
      toRemoveKnownDeviceInput(request, input),
    );
    ok(response, result, {
      message: "Device is no longer trusted.",
    });
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
