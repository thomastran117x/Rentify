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
   * upserts by the hint and binds that row; a hint row a different browser
   * bound before is rebound to this one, since only one can hold the hint.
   */
  async registerKnownDevice(
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

    if (input.bindingId) {
      const bound = await this.findByBindingId(input.userId, input.bindingId);

      if (bound) {
        const device = await this.executeAsync(() =>
          this.prisma.device.update({
            where: { id: bound.id },
            data: details,
          }),
        );

        return this.mapDevice(device);
      }
    }

    const binding = input.bindingId ? { bindingId: input.bindingId } : {};
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

  async setTrust(
    id: Uuid,
    trustedUntil: Date,
    tokenVersion: number,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.device.update({
        where: { id },
        data: { trustedUntil, trustedTokenVersion: tokenVersion },
      }),
    );
  }

  /**
   * Ends one device's trust. Null when the account has no such device; false
   * when it has one that was not trusted.
   */
  async revokeTrust(userId: Uuid, deviceId: string): Promise<boolean | null> {
    const device = await this.executeAsync(() =>
      this.prisma.device.findUnique({
        where: { userId_deviceId: { userId, deviceId } },
        select: { id: true, trustedUntil: true },
      }),
    );

    if (!device) {
      return null;
    }

    if (!device.trustedUntil) {
      return false;
    }

    await this.executeAsync(() =>
      this.prisma.device.update({
        where: { id: device.id },
        data: { trustedUntil: null, trustedTokenVersion: null },
      }),
    );
    return true;
  }

  /** Ends every device's trust on the account; returns how many had it. */
  async revokeAllTrust(userId: Uuid): Promise<number> {
    const result = await this.executeAsync(() =>
      this.prisma.device.updateMany({
        where: { userId, trustedUntil: { not: null } },
        data: { trustedUntil: null, trustedTokenVersion: null },
      }),
    );

    return result.count;
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
      firstSeenAt: device.firstSeenAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      verifiedAt: device.verifiedAt.toISOString(),
    };
  }
}
