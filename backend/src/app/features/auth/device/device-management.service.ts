import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { AuthRequestContext } from "@/features/auth/auth.model";
import { DeviceService } from "@/features/auth/device/device.service";
import { TokenService } from "@/features/auth/token/token.service";
import { requireExistingUser } from "@/features/auth/require-existing-user";
import type {
  DeviceVerifyResult,
  KnownDeviceListResult,
  RemoveKnownDeviceInput,
  RemoveKnownDeviceResult,
} from "@/features/auth/device/device-management.model";
import { asUuid } from "@/configuration/validation/uuid";

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

  async devices(context: AuthRequestContext): Promise<KnownDeviceListResult> {
    const knownDevices = await this.deviceService.listKnownDevices(
      context.auth.sub,
      context.auth.deviceId,
    );

    return {
      devices: knownDevices.map((device) => ({
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
      })),
    };
  }

  /**
   * Removing a device also revokes its sessions: leaving them live would mean
   * "sign this device out" only removed it from the list.
   */
  async removeKnownDevice(
    input: RemoveKnownDeviceInput,
  ): Promise<RemoveKnownDeviceResult> {
    await this.deviceService.removeKnownDevice(input.userId, input.deviceId);
    await this.tokenService.revokeSessionsForDevice(
      input.userId,
      input.deviceId,
    );

    return {
      removed: true,
      deviceId: input.deviceId,
    };
  }
}
