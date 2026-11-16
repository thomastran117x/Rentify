import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

interface RegisterKnownDeviceInput {
  userId: Uuid;
  deviceId: string;
  type: string;
  platform?: string;
  userAgent?: string;
  ipAddress?: string;
  /** The verified device cookie's id; omitted, the row stays a hint row. */
  bindingId?: string;
  /** "Remember this device", written with the registration in one update. */
  trust?: {
    trustedUntil: Date;
    tokenVersion: number;
    mfaFactorVersion: number;
  };
}

export interface KnownDeviceRecord {
  id: Uuid;
  userId: Uuid;
  deviceId: string;
  type: string;
  platform?: string;
  userAgent?: string;
  lastIpAddress?: string;
  /** Set when the device registered with a verified device cookie. */
  bindingId?: string;
  /** "Remember this device", until this time; see {@link trustedTokenVersion}. */
  trustedUntil?: string;
  /** Trust counts only while the account's token version still matches. */
  trustedTokenVersion?: number;
  /** ...and while its MFA factor version still matches. */
  trustedMfaVersion?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  verifiedAt: string;
}

type DevicePersistence = {
  id: string;
  userId: string;
  deviceId: string;
  type: string;
  platform: string | null;
  userAgent: string | null;
  lastIpAddress: string | null;
  bindingId: string | null;
  trustedUntil: Date | null;
  trustedTokenVersion: number | null;
  trustedMfaVersion: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  verifiedAt: Date;
};

export class DeviceRepository extends BaseRepository {
  async hasAnyKnownDevice(userId: Uuid): Promise<boolean> {
    const count = await this.executeAsync(() =>
      this.prisma.device.count({
        where: {
          userId,
        },
      }),
    );

    return count > 0;
  }

  async hasKnownIpAddress(userId: Uuid, ipAddress: string): Promise<boolean> {
    const count = await this.executeAsync(() =>
      this.prisma.device.count({
        where: {
          userId,
          lastIpAddress: ipAddress,
        },
      }),
    );

    return count > 0;
  }

  /**
   * The device a verified device cookie belongs to. This, not the
   * client-chosen device id, is what makes a device known.
   */
  async findByBindingId(
    userId: Uuid,
    bindingId: string,
  ): Promise<KnownDeviceRecord | null> {
    const device = await this.executeAsync(() =>
      this.prisma.device.findUnique({
        where: {
          userId_bindingId: {
            userId,
            bindingId,
          },
        },
      }),
    );

    return device ? this.mapDevice(device) : null;
  }

  /**
   * A bound registration updates the row that already holds the binding, so a
   * browser whose hint changed (cleared storage) keeps one row. Otherwise it
   * upserts by the hint and binds that row; a hint row a different cookie
   * bound before is rebound to this one, since only one can hold the hint.
   * Rebinding clears the row's trust: trust belongs to the cookie it was
   * granted to, and a new one earns it only through "Remember this device".
   */
  async registerKnownDevice(
    input: RegisterKnownDeviceInput,
  ): Promise<KnownDeviceRecord> {
    try {
      return await this.registerKnownDeviceOnce(input);
    } catch (error) {
      // Two requests from one browser (two tabs, or verify beside "Remember
      // this device") can both miss the lookup and both insert. The loser
      // hits a unique key, and its second pass finds the winner's row.
      if (isUniqueConstraintError(error)) {
        return this.registerKnownDeviceOnce(input);
      }
      throw error;
    }
  }

  private async registerKnownDeviceOnce(
    input: RegisterKnownDeviceInput,
  ): Promise<KnownDeviceRecord> {
    const now = new Date();
    const details = {
      type: input.type,
      platform: input.platform ?? null,
      userAgent: input.userAgent ?? null,
      lastIpAddress: input.ipAddress ?? null,
      lastSeenAt: now,
      verifiedAt: now,
    };
    const trust = input.trust
      ? {
          trustedUntil: input.trust.trustedUntil,
          trustedTokenVersion: input.trust.tokenVersion,
          trustedMfaVersion: input.trust.mfaFactorVersion,
        }
      : {};

    if (input.bindingId) {
      const bound = await this.findByBindingId(input.userId, input.bindingId);

      if (bound) {
        const device = await this.executeAsync(() =>
          this.prisma.device.update({
            where: { id: bound.id },
            data: { ...details, ...trust },
          }),
        );

        return this.mapDevice(device);
      }
    }

    // Rebinding a row clears trust granted to another cookie; a grant in this
    // same registration then sets it afresh.
    const binding = input.bindingId
      ? {
          bindingId: input.bindingId,
          trustedUntil: null,
          trustedTokenVersion: null,
          trustedMfaVersion: null,
          ...trust,
        }
      : trust;
    const device = await this.executeAsync(() =>
      this.prisma.device.upsert({
        where: {
          userId_deviceId: {
            userId: input.userId,
            deviceId: input.deviceId,
          },
        },
        create: {
          id: newUuid(),
          userId: input.userId,
          deviceId: input.deviceId,
          ...details,
          ...binding,
          firstSeenAt: now,
        },
        update: {
          ...details,
          ...binding,
        },
      }),
    );

    return this.mapDevice(device);
  }

  /** The account's device registered under a client device id. */
  async findByDeviceId(
    userId: Uuid,
    deviceId: string,
  ): Promise<KnownDeviceRecord | null> {
    const device = await this.executeAsync(() =>
      this.prisma.device.findUnique({
        where: { userId_deviceId: { userId, deviceId } },
      }),
    );

    return device ? this.mapDevice(device) : null;
  }

  /**
   * Binds a row that has no binding yet. A no-op, reported as false, when the
   * row was bound meanwhile or the account already holds this binding.
   */
  async bindUnboundDevice(id: Uuid, bindingId: string): Promise<boolean> {
    try {
      const result = await this.executeAsync(() =>
        this.prisma.device.updateMany({
          where: { id, bindingId: null },
          data: { bindingId },
        }),
      );

      return result.count === 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }

  async touchKnownDevice(id: Uuid, ipAddress?: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.device.update({
        where: { id },
        data: {
          lastSeenAt: new Date(),
          ...(ipAddress ? { lastIpAddress: ipAddress } : {}),
        },
      }),
    );
  }

  /**
   * Clears one device's trust, stale or not, and returns the device as it was
   * before, or null when the account has no such device. The caller decides
   * whether that trust was still in force.
   */
  async revokeTrust(
    userId: Uuid,
    deviceId: string,
  ): Promise<KnownDeviceRecord | null> {
    const device = await this.findByDeviceId(userId, deviceId);

    if (device?.trustedUntil) {
      await this.executeAsync(() =>
        this.prisma.device.update({
          where: { id: device.id },
          data: {
            trustedUntil: null,
            trustedTokenVersion: null,
            trustedMfaVersion: null,
          },
        }),
      );
    }

    return device;
  }

  async touchKnownIpAddress(userId: Uuid, ipAddress: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.device.updateMany({
        where: {
          userId,
          lastIpAddress: ipAddress,
        },
        data: {
          lastSeenAt: new Date(),
        },
      }),
    );
  }

  async listKnownDevices(userId: Uuid): Promise<KnownDeviceRecord[]> {
    const devices = await this.executeAsync(() =>
      this.prisma.device.findMany({
        where: {
          userId,
        },
        orderBy: {
          lastSeenAt: "desc",
        },
      }),
    );

    return devices.map((device) => this.mapDevice(device));
  }

  /** Just the ids of the user's registered devices, for membership checks. */
  async listKnownDeviceIds(userId: Uuid): Promise<string[]> {
    const devices = await this.executeAsync(() =>
      this.prisma.device.findMany({
        where: { userId },
        select: { deviceId: true },
      }),
    );

    return devices.map((device) => device.deviceId);
  }

  async removeKnownDevice(userId: Uuid, deviceId: string): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.device.deleteMany({
        where: {
          userId,
          deviceId,
        },
      }),
    );

    return result.count > 0;
  }

  private mapDevice(device: DevicePersistence): KnownDeviceRecord {
    return {
      id: asUuid(device.id),
      userId: asUuid(device.userId),
      deviceId: device.deviceId,
      type: device.type,
      platform: device.platform ?? undefined,
      userAgent: device.userAgent ?? undefined,
      lastIpAddress: device.lastIpAddress ?? undefined,
      bindingId: device.bindingId ?? undefined,
      trustedUntil: device.trustedUntil?.toISOString(),
      trustedTokenVersion: device.trustedTokenVersion ?? undefined,
      trustedMfaVersion: device.trustedMfaVersion ?? undefined,
      firstSeenAt: device.firstSeenAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      verifiedAt: device.verifiedAt.toISOString(),
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
