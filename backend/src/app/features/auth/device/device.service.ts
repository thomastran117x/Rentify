import type { ClientRequestContext } from "@/configuration/http/bindings";
import BadRequestError from "@/errors/http/bad-request.error";
import type { CacheService } from "@/features/cache/cache.service";
import { EmailService } from "@/features/email/email.service";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { DeviceRepository, type KnownDeviceRecord } from "./device.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

interface DeviceServiceOptions {
  deviceRepository: DeviceRepository;
  emailService: EmailService;
  cache: CacheService;
  authAuditService: AuthAuditService;
  unknownDeviceAlertCooldownInSeconds?: number;
}

export interface KnownDeviceStatus {
  deviceId?: string;
  known: boolean;
  knownByIp: boolean;
}

const DEFAULT_UNKNOWN_DEVICE_ALERT_COOLDOWN_SECONDS = 60 * 60;

export class DeviceService {
  private readonly deviceRepository: DeviceRepository;
  private readonly emailService: EmailService;
  private readonly cache: CacheService;
  private readonly authAuditService: AuthAuditService;
  private readonly unknownDeviceAlertCooldownInSeconds: number;

  constructor(options: DeviceServiceOptions) {
    this.deviceRepository = options.deviceRepository;
    this.emailService = options.emailService;
    this.cache = options.cache;
    this.authAuditService = options.authAuditService;
    this.unknownDeviceAlertCooldownInSeconds =
      options.unknownDeviceAlertCooldownInSeconds ??
      DEFAULT_UNKNOWN_DEVICE_ALERT_COOLDOWN_SECONDS;
  }

  async registerKnownDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
  ): Promise<KnownDeviceStatus> {
    if (!deviceId) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    await this.deviceRepository.registerKnownDevice({
      userId: asUuid(user.id),
      deviceId,
      type: client.device.type,
      platform: client.device.platform,
      userAgent: client.device.userAgent,
      ipAddress: client.ip,
    });

    return {
      deviceId,
      known: true,
      knownByIp: Boolean(client.ip),
    };
  }

  async evaluateSuccessfulAuthentication(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
    audit?: AuthAuditContext,
  ): Promise<KnownDeviceStatus> {
    if (deviceId) {
      const knownDevice = await this.deviceRepository.findKnownDevice(
        asUuid(user.id),
        deviceId,
      );

      if (knownDevice) {
        await this.deviceRepository.touchKnownDevice(
          asUuid(user.id),
          deviceId,
          client.ip,
        );

        return {
          deviceId,
          known: true,
          knownByIp: Boolean(
            client.ip && knownDevice.lastIpAddress === client.ip,
          ),
        };
      }
    }

    if (!client.ip) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    const knownByIp = await this.deviceRepository.hasKnownIpAddress(
      asUuid(user.id),
      client.ip,
    );

    if (knownByIp) {
      await this.deviceRepository.touchKnownIpAddress(user.id, client.ip);

      return {
        deviceId,
        known: false,
        knownByIp: true,
      };
    }

    await this.notifyUnknownDevice(
      user,
      client,
      deviceId ?? "unknown-device",
      audit,
    );

    return {
      deviceId,
      known: false,
      knownByIp: false,
    };
  }

  async evaluateExistingSessionDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
    audit?: AuthAuditContext,
  ): Promise<KnownDeviceStatus> {
    if (deviceId) {
      const knownDevice = await this.deviceRepository.findKnownDevice(
        asUuid(user.id),
        deviceId,
      );

      if (knownDevice) {
        await this.deviceRepository.touchKnownDevice(
          asUuid(user.id),
          deviceId,
          client.ip,
        );

        return {
          deviceId,
          known: true,
          knownByIp: Boolean(
            client.ip && knownDevice.lastIpAddress === client.ip,
          ),
        };
      }
    }

    if (!client.ip) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    const knownByIp = await this.deviceRepository.hasKnownIpAddress(
      asUuid(user.id),
      client.ip,
    );

    if (knownByIp) {
      await this.deviceRepository.touchKnownIpAddress(user.id, client.ip);

      return {
        deviceId,
        known: false,
        knownByIp: true,
      };
    }

    if (!(await this.deviceRepository.hasAnyKnownDevice(user.id))) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    await this.notifyUnknownDevice(
      user,
      client,
      deviceId ?? "unknown-device",
      audit,
    );

    return {
      deviceId,
      known: false,
      knownByIp: false,
    };
  }

  async listKnownDevices(
    userId: Uuid,
    currentDeviceId?: string,
  ): Promise<
    Array<
      KnownDeviceRecord & {
        current: boolean;
      }
    >
  > {
    const devices = await this.deviceRepository.listKnownDevices(userId);

    return devices.map((device) => ({
      ...device,
      current: device.deviceId === currentDeviceId,
    }));
  }

  async removeKnownDevice(userId: Uuid, deviceId: string): Promise<void> {
    const wasRemoved = await this.deviceRepository.removeKnownDevice(
      userId,
      deviceId,
    );

    if (!wasRemoved) {
      throw new BadRequestError("Known device could not be found.");
    }
  }

  private async notifyUnknownDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string,
    audit?: AuthAuditContext,
  ): Promise<void> {
    const notificationKey = `auth:unknown-device:${user.id}:${deviceId}`;
    const shouldSend = await this.cache.setIfNotExists(
      notificationKey,
      "1",
      this.unknownDeviceAlertCooldownInSeconds,
    );

    if (!shouldSend) {
      await this.recordNewDevice(user, client, deviceId, "suppressed", audit);
      return;
    }

    await this.emailService.sendNewDeviceEmail({
      to: user.email,
      firstName: user.firstName,
      deviceLabel: deviceId,
      ipAddress: client.ip,
      platform: client.device.platform,
      userAgent: client.device.userAgent,
      detectedAt: new Date(),
    });
    await this.recordNewDevice(user, client, deviceId, "sent", audit);
  }

  private async recordNewDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string,
    emailNotification: "sent" | "suppressed",
    audit?: AuthAuditContext,
  ): Promise<void> {
    await this.authAuditService.recordSafely({
      eventType: "device.new_detected",
      outcome: "success",
      userId: asUuid(user.id),
      context: audit ?? {
        ipAddress: client.ip,
        userAgent: client.device.userAgent,
        deviceId,
      },
      metadata: { emailNotification },
    });
  }
}
