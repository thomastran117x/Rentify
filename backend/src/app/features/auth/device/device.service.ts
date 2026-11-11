import type { ClientRequestContext } from "@/configuration/http/bindings";
import { loggerFactory } from "@/configuration/logging";
import BadRequestError from "@/errors/http/bad-request.error";
import type { CacheService } from "@/features/cache/cache.service";
import { EmailService } from "@/features/email/email.service";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { DeviceRepository, type KnownDeviceRecord } from "./device.repository";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import { issueSelfLockLinkToken } from "@/features/auth/self-lock/self-lock-link";
import type { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";

interface DeviceServiceOptions {
  deviceRepository: DeviceRepository;
  emailService: EmailService;
  cache: CacheService;
  authAuditService: AuthAuditService;
  selfLockTokenStore: SelfLockTokenStore;
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
  private readonly selfLockTokenStore: SelfLockTokenStore;
  private readonly unknownDeviceAlertCooldownInSeconds: number;
  private readonly logger = loggerFactory.forClass(DeviceService, "service");

  constructor(options: DeviceServiceOptions) {
    this.deviceRepository = options.deviceRepository;
    this.emailService = options.emailService;
    this.cache = options.cache;
    this.authAuditService = options.authAuditService;
    this.selfLockTokenStore = options.selfLockTokenStore;
    this.unknownDeviceAlertCooldownInSeconds =
      options.unknownDeviceAlertCooldownInSeconds ??
      DEFAULT_UNKNOWN_DEVICE_ALERT_COOLDOWN_SECONDS;
  }

  /**
   * Records the device as verified. Only a request that presented a verified
   * device cookie binds the row; without one (a client that keeps no cookies)
   * the row is a hint row, listed and signed out like any other, which never
   * makes a sign-in known.
   */
  async registerKnownDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
  ): Promise<KnownDeviceStatus> {
    const bindingId = client.deviceBinding?.id;
    const rowDeviceId = deviceId ?? bindingId;

    if (!rowDeviceId) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    await this.deviceRepository.registerKnownDevice({
      userId: asUuid(user.id),
      deviceId: rowDeviceId,
      type: client.device.type,
      platform: client.device.platform,
      userAgent: client.device.userAgent,
      ipAddress: client.ip,
      ...(bindingId ? { bindingId } : {}),
    });

    return {
      deviceId,
      known: Boolean(bindingId),
      knownByIp: Boolean(client.ip),
    };
  }

  /**
   * A sign-in. The device is known only by its verified device cookie: the
   * `deviceId` hint labels it, but a forged one matches nothing. Otherwise a
   * known IP is enough to skip the alert, and anything else sends it.
   */
  async evaluateSuccessfulAuthentication(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
    audit?: AuthAuditContext,
  ): Promise<KnownDeviceStatus> {
    const known = await this.findBoundDevice(user, client);

    if (known) {
      return known;
    }

    if (!client.ip) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    if (await this.touchIfKnownIp(user, client.ip)) {
      return {
        deviceId,
        known: false,
        knownByIp: true,
      };
    }

    await this.notifyUnknownDevice(user, client, deviceId, audit);

    return {
      deviceId,
      known: false,
      knownByIp: false,
    };
  }

  /**
   * A refresh or reissue of a session that already exists. As
   * {@link evaluateSuccessfulAuthentication}, except an account with no
   * registered device yet is not alerted.
   */
  async evaluateExistingSessionDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
    audit?: AuthAuditContext,
  ): Promise<KnownDeviceStatus> {
    const known = await this.findBoundDevice(user, client);

    if (known) {
      return known;
    }

    if (!client.ip) {
      return {
        deviceId,
        known: false,
        knownByIp: false,
      };
    }

    if (await this.touchIfKnownIp(user, client.ip)) {
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

    await this.notifyUnknownDevice(user, client, deviceId, audit);

    return {
      deviceId,
      known: false,
      knownByIp: false,
    };
  }

  private async findBoundDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
  ): Promise<KnownDeviceStatus | null> {
    const bindingId = client.deviceBinding?.id;

    if (!bindingId) {
      return null;
    }

    const knownDevice = await this.deviceRepository.findByBindingId(
      asUuid(user.id),
      bindingId,
    );

    if (!knownDevice) {
      return null;
    }

    await this.deviceRepository.touchKnownDevice(knownDevice.id, client.ip);

    // The row's id, not this request's hint: a browser whose storage was
    // cleared sends a new hint, but its sessions must stay under the id the
    // device list shows, so removing that device signs them out.
    return {
      deviceId: knownDevice.deviceId,
      known: true,
      knownByIp: Boolean(client.ip && knownDevice.lastIpAddress === client.ip),
    };
  }

  private async touchIfKnownIp(
    user: AuthUserRecord,
    ipAddress: string,
  ): Promise<boolean> {
    const knownByIp = await this.deviceRepository.hasKnownIpAddress(
      asUuid(user.id),
      ipAddress,
    );

    if (knownByIp) {
      await this.deviceRepository.touchKnownIpAddress(user.id, ipAddress);
    }

    return knownByIp;
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

  /**
   * The cooldown is per verified device when there is one, so a forged hint
   * cannot spend another device's cooldown and silence its alert.
   */
  private async notifyUnknownDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string | undefined,
    audit?: AuthAuditContext,
  ): Promise<void> {
    const deviceLabel = deviceId ?? "unknown-device";
    const cooldownSubject = client.deviceBinding
      ? `bound:${client.deviceBinding.id}`
      : deviceLabel;
    const notificationKey = `auth:unknown-device:${user.id}:${cooldownSubject}`;
    const shouldSend = await this.cache.setIfNotExists(
      notificationKey,
      "1",
      this.unknownDeviceAlertCooldownInSeconds,
    );

    if (!shouldSend) {
      await this.recordNewDevice(
        user,
        client,
        deviceLabel,
        "suppressed",
        audit,
      );
      return;
    }

    // The event's id is chosen up front so the lock link can name it.
    const eventId = newUuid();
    const selfLockToken = await issueSelfLockLinkToken(
      this.selfLockTokenStore,
      user,
      eventId,
      this.logger,
    );

    await this.emailService.sendNewDeviceEmail({
      to: user.email,
      firstName: user.firstName,
      deviceLabel,
      ipAddress: client.ip,
      platform: client.device.platform,
      userAgent: client.device.userAgent,
      detectedAt: new Date(),
      ...(selfLockToken ? { selfLockToken } : {}),
    });
    await this.recordNewDevice(
      user,
      client,
      deviceLabel,
      "sent",
      audit,
      eventId,
    );
  }

  private async recordNewDevice(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string,
    emailNotification: "sent" | "suppressed",
    audit?: AuthAuditContext,
    eventId?: Uuid,
  ): Promise<void> {
    await this.authAuditService.recordSafely({
      ...(eventId ? { id: eventId } : {}),
      eventType: "device.new_detected",
      outcome: "success",
      userId: asUuid(user.id),
      context: audit ?? {
        ipAddress: client.ip,
        userAgent: client.device.userAgent,
        deviceId,
      },
      // Whether the device presented a verified device cookie. A device id
      // that arrived only as the client's hint is recorded as unverified.
      metadata: {
        emailNotification,
        deviceBinding: client.deviceBinding ? "verified" : "unverified",
      },
    });
  }
}
