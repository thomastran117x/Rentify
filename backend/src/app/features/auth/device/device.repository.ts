import { randomUUID } from "node:crypto";
import { BaseRepository } from "@/features/base/base.repository";

interface RegisterKnownDeviceInput {
  userId: string;
  deviceId: string;
  type: string;
  platform?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface KnownDeviceRecord {
  id: string;
  userId: string;
  deviceId: string;
  type: string;
  platform?: string;
  userAgent?: string;
  lastIpAddress?: string;
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
  firstSeenAt: Date;
  lastSeenAt: Date;
  verifiedAt: Date;
};

export class DeviceRepository extends BaseRepository {
  async hasAnyKnownDevice(userId: string): Promise<boolean> {
    const count = await this.executeAsync(() =>
      this.prisma.device.count({
        where: {
          userId,
        },
      }),
    );

    return count > 0;
  }

  async hasKnownIpAddress(userId: string, ipAddress: string): Promise<boolean> {
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

  async findKnownDevice(
    userId: string,
    deviceId: string,
  ): Promise<KnownDeviceRecord | null> {
    const device = await this.executeAsync(() =>
      this.prisma.device.findUnique({
        where: {
          userId_deviceId: {
            userId,
            deviceId,
          },
        },
      }),
    );

    return device ? this.mapDevice(device) : null;
  }

  async registerKnownDevice(
    input: RegisterKnownDeviceInput,
  ): Promise<KnownDeviceRecord> {
    const now = new Date();
    const device = await this.executeAsync(() =>
      this.prisma.device.upsert({
        where: {
          userId_deviceId: {
            userId: input.userId,
            deviceId: input.deviceId,
          },
        },
        create: {
          id: randomUUID(),
          userId: input.userId,
          deviceId: input.deviceId,
          type: input.type,
          platform: input.platform ?? null,
          userAgent: input.userAgent ?? null,
          lastIpAddress: input.ipAddress ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          verifiedAt: now,
        },
        update: {
          type: input.type,
          platform: input.platform ?? null,
          userAgent: input.userAgent ?? null,
          lastIpAddress: input.ipAddress ?? null,
          lastSeenAt: now,
          verifiedAt: now,
        },
      }),
    );

    return this.mapDevice(device);
  }

  async touchKnownDevice(
    userId: string,
    deviceId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.device.update({
        where: {
          userId_deviceId: {
            userId,
            deviceId,
          },
        },
        data: {
          lastSeenAt: new Date(),
          ...(ipAddress ? { lastIpAddress: ipAddress } : {}),
        },
      }),
    );
  }

  async touchKnownIpAddress(userId: string, ipAddress: string): Promise<void> {
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

  async listKnownDevices(userId: string): Promise<KnownDeviceRecord[]> {
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

  async removeKnownDevice(userId: string, deviceId: string): Promise<boolean> {
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
      id: device.id,
      userId: device.userId,
      deviceId: device.deviceId,
      type: device.type,
      platform: device.platform ?? undefined,
      userAgent: device.userAgent ?? undefined,
      lastIpAddress: device.lastIpAddress ?? undefined,
      firstSeenAt: device.firstSeenAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      verifiedAt: device.verifiedAt.toISOString(),
    };
  }
}
