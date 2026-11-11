import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { AuthRequestContext } from "@/features/auth/auth.model";
import { DeviceService } from "@/features/auth/device/device.service";
import {
  isDeviceTrustActive,
  type DeviceTrustService,
} from "@/features/auth/device/device-trust.service";
import { TokenService } from "@/features/auth/token/token.service";
import { requireExistingUser } from "@/features/auth/require-existing-user";
import type {
  DeviceVerifyResult,
  KnownDeviceListResult,
  RemoveKnownDeviceInput,
  RemoveKnownDeviceResult,
  RevokeDeviceTrustResult,
} from "@/features/auth/device/device-management.model";
import { asUuid } from "@/configuration/validation/uuid";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";

/**
 * The device surface a signed-in user manages for themselves. Distinct from
 * {@link DeviceService}, which decides whether a device is trusted during
 * authentication; this only reads and edits the resulting list.
 */
export class DeviceManagementService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly deviceService: DeviceService,
    private readonly tokenService: TokenService,
    private readonly authAuditService: AuthAuditService,
    private readonly deviceTrustService: Pick<DeviceTrustService, "revoke">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async deviceVerify(context: AuthRequestContext): Promise<DeviceVerifyResult> {
    const user = await requireExistingUser(
      this.usersRepository,
      context.auth.sub,
    );
    const deviceStatus = await this.deviceService.registerKnownDevice(
      user,
      context.client,
      context.auth.deviceId ?? context.client.device.id,
    );

    return {
      verified: true,
      device: {
        ...context.client.device,
        known: deviceStatus.known,
        knownByIp: deviceStatus.knownByIp,
        deviceId: deviceStatus.deviceId,
      },
      auth: {
        userId: asUuid(context.auth.sub),
        tokenDeviceId: context.auth.deviceId,
      },
    };
  }

  /**
   * Trust is judged against the account's current token version, so a device
   * whose trust a password change or sign-out-everywhere ended shows as not
   * trusted even though its row still holds the old values.
   */
  async devices(context: AuthRequestContext): Promise<KnownDeviceListResult> {
    const user = await requireExistingUser(
      this.usersRepository,
      context.auth.sub,
    );
    const knownDevices = await this.deviceService.listKnownDevices(
      context.auth.sub,
      context.auth.deviceId,
    );
    const now = this.now();

    return {
      devices: knownDevices.map((device) => {
        const trusted = isDeviceTrustActive(device, user.tokenVersion, now);

        return {
          id: device.id,
          current: device.current,
          deviceId: device.deviceId,
          type: device.type,
          platform: device.platform,
          userAgent: device.userAgent,
          lastIpAddress: device.lastIpAddress,
          firstSeenAt: device.firstSeenAt,
          lastSeenAt: device.lastSeenAt,
          verifiedAt: device.verifiedAt,
          bound: device.bindingId !== undefined,
          trusted,
          ...(trusted ? { trustedUntil: device.trustedUntil } : {}),
        };
      }),
    };
  }

  /** "Stop trusting": the device stays known, but its next sign-in asks for a code. */
  async revokeDeviceTrust(
    input: RemoveKnownDeviceInput,
  ): Promise<RevokeDeviceTrustResult> {
    const revoked = await this.deviceTrustService.revoke(
      input.userId,
      input.deviceId,
      input.audit,
    );

    return { revoked, deviceId: input.deviceId };
  }

  /**
   * Removing a device also revokes its sessions: leaving them live would mean
   * "sign this device out" only removed it from the list.
   */
  async removeKnownDevice(
    input: RemoveKnownDeviceInput,
  ): Promise<RemoveKnownDeviceResult> {
    await this.deviceService.removeKnownDevice(input.userId, input.deviceId);
    const revokedSessionIds = await this.tokenService.revokeSessionsForDevice(
      input.userId,
      input.deviceId,
    );

    for (const sessionId of revokedSessionIds) {
      await this.authAuditService.recordSafely({
        eventType: "session.revoked",
        outcome: "success",
        userId: input.userId,
        sessionId,
        context: input.audit,
        metadata: { source: "device" },
      });
    }

    return {
      removed: true,
      deviceId: input.deviceId,
    };
  }
}
