import { environment } from "@/configuration/environment";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { loggerFactory } from "@/configuration/logging";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import BadRequestError from "@/errors/http/bad-request.error";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type {
  DeviceRepository,
  KnownDeviceRecord,
} from "@/features/auth/device/device.repository";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Why every device's trust was ended. Changes that rotate the token version
 * (a password change or reset, signing out everywhere, a lock) end it without
 * a call, so they are not listed here.
 */
export type DeviceTrustRevocationReason =
  | "mfa_enabled"
  | "mfa_disabled"
  | "passkey_added"
  | "passkey_removed";

export interface DeviceTrustGrant {
  trustedUntil: string;
}

interface DeviceTrustServiceOptions {
  deviceRepository: Pick<
    DeviceRepository,
    | "findByBindingId"
    | "registerKnownDevice"
    | "setTrust"
    | "revokeTrust"
    | "revokeAllTrust"
  >;
  authAuditService: Pick<AuthAuditService, "recordSafely">;
  getTtlDays?: () => number;
  now?: () => Date;
}

/**
 * Whether a device record is trusted right now for an account at the given
 * token version. Any rotation of the version (a password change, signing out
 * everywhere, a lock) ends trust without touching the row.
 */
export function isDeviceTrustActive(
  device: Pick<KnownDeviceRecord, "trustedUntil" | "trustedTokenVersion">,
  tokenVersion: number,
  now: Date,
): boolean {
  return (
    device.trustedUntil !== undefined &&
    Date.parse(device.trustedUntil) > now.getTime() &&
    device.trustedTokenVersion === tokenVersion
  );
}

/**
 * "Remember this device": a bound device that finished login MFA once skips it
 * at later sign-ins until the trust lapses or is revoked. Only the sign-in's
 * second factor is skipped, never a step-up. Trust lives on the device row and
 * is reached only through the verified device cookie, so a client without
 * cookies can never hold it. See docs/auth-security.md#trusted-devices.
 */
export class DeviceTrustService {
  private readonly deviceRepository: DeviceTrustServiceOptions["deviceRepository"];
  private readonly authAuditService: DeviceTrustServiceOptions["authAuditService"];
  private readonly getTtlDays: () => number;
  private readonly now: () => Date;
  private readonly logger = loggerFactory.forClass(
    DeviceTrustService,
    "service",
  );

  constructor(options: DeviceTrustServiceOptions) {
    this.deviceRepository = options.deviceRepository;
    this.authAuditService = options.authAuditService;
    this.getTtlDays =
      options.getTtlDays ??
      (() => environment.getAuthSecurityConfig().deviceTrust.ttlDays);
    this.now = options.now ?? (() => new Date());
  }

  ttlDays(): number {
    return this.getTtlDays();
  }

  /** The trust this request's device holds for the account, if any. */
  async findTrust(
    user: AuthUserRecord,
    client: ClientRequestContext,
  ): Promise<DeviceTrustGrant | null> {
    const bindingId = client.deviceBinding?.id;

    if (!bindingId) {
      return null;
    }

    const device = await this.deviceRepository.findByBindingId(
      asUuid(user.id),
      bindingId,
    );

    if (
      !device?.trustedUntil ||
      !isDeviceTrustActive(device, user.tokenVersion, this.now())
    ) {
      return null;
    }

    return { trustedUntil: device.trustedUntil };
  }

  /**
   * Registers the device by its cookie and trusts it for the configured TTL.
   * A client that presented no device cookie gets nothing: there would be no
   * way to recognise it again.
   */
  async trust(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string | undefined,
    audit?: AuthAuditContext,
  ): Promise<DeviceTrustGrant | null> {
    const bindingId = client.deviceBinding?.id;

    if (!bindingId) {
      return null;
    }

    const userId = asUuid(user.id);
    const device = await this.deviceRepository.registerKnownDevice({
      userId,
      deviceId: deviceId ?? bindingId,
      type: client.device.type,
      platform: client.device.platform,
      userAgent: client.device.userAgent,
      ipAddress: client.ip,
      bindingId,
    });
    const trustedUntil = new Date(
      this.now().getTime() + this.getTtlDays() * DAY_IN_MS,
    );

    await this.deviceRepository.setTrust(
      device.id,
      trustedUntil,
      user.tokenVersion,
    );
    await this.authAuditService.recordSafely({
      eventType: "device.trusted",
      outcome: "success",
      userId,
      context: audit,
      metadata: { trustedUntil: trustedUntil.toISOString() },
    });

    return { trustedUntil: trustedUntil.toISOString() };
  }

  /**
   * Best effort, for a sign-in whose session is already issued: failing to
   * remember the device only means the next sign-in asks for a code.
   */
  async trustSafely(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string | undefined,
    audit?: AuthAuditContext,
  ): Promise<DeviceTrustGrant | null> {
    try {
      return await this.trust(user, client, deviceId, audit);
    } catch (error) {
      this.logger.error("Failed to remember a device after sign-in.", {
        userId: user.id,
        error,
      });
      return null;
    }
  }

  /** "Stop trusting" from the device list. */
  async revoke(
    userId: Uuid,
    deviceId: string,
    audit?: AuthAuditContext,
  ): Promise<boolean> {
    const revoked = await this.deviceRepository.revokeTrust(userId, deviceId);

    if (revoked === null) {
      throw new BadRequestError("Known device could not be found.");
    }

    if (revoked) {
      await this.authAuditService.recordSafely({
        eventType: "device.trust_revoked",
        outcome: "success",
        userId,
        context: audit,
        metadata: { reason: "user", scope: "one" },
      });
    }

    return revoked;
  }

  /**
   * Ends trust on every device of the account. Callers run it before the
   * change it accompanies, so a failure leaves that change undone and
   * retryable rather than done with trust left behind.
   */
  async revokeAll(
    userId: Uuid,
    reason: DeviceTrustRevocationReason,
    audit?: AuthAuditContext,
  ): Promise<number> {
    const count = await this.deviceRepository.revokeAllTrust(userId);

    if (count > 0) {
      await this.authAuditService.recordSafely({
        eventType: "device.trust_revoked",
        outcome: "success",
        userId,
        context: audit,
        metadata: { reason, scope: "all", count },
      });
    }

    return count;
  }
}
