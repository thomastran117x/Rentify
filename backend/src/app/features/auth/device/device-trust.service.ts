import { environment } from "@/configuration/environment";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import { loggerFactory } from "@/configuration/logging";
import { asUuid } from "@/configuration/validation/uuid";
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
 * Why a factor change ended every device's trust. Changes that rotate the
 * token version (a password change or reset, signing out everywhere, a lock)
 * end it without an event, so they are not listed here.
 */
export type DeviceTrustRevocationReason =
  | "mfa_enabled"
  | "mfa_disabled"
  | "passkey_added"
  | "passkey_removed";

export interface DeviceTrustGrant {
  trustedUntil: string;
}

/** The account state trust is pinned to. */
export type DeviceTrustAccount = Pick<
  AuthUserRecord,
  "tokenVersion" | "mfaFactorVersion"
>;

type TrustFields = Pick<
  KnownDeviceRecord,
  "trustedUntil" | "trustedTokenVersion" | "trustedMfaVersion"
>;

interface DeviceTrustServiceOptions {
  deviceRepository: Pick<
    DeviceRepository,
    "findByBindingId" | "registerKnownDevice" | "revokeTrust"
  >;
  authAuditService: Pick<AuthAuditService, "recordSafely">;
  getTtlDays?: () => number;
  now?: () => Date;
}

/**
 * Whether a device record is trusted right now for the account. Trust is
 * pinned to the account's token version and MFA factor version, so rotating
 * either (a password change, signing out everywhere, a lock, any passkey or
 * authenticator change) ends it without touching the row, and a grant that
 * raced such a change is void.
 */
export function isDeviceTrustActive<T extends TrustFields>(
  device: T,
  account: DeviceTrustAccount,
  now: Date,
): device is T & { trustedUntil: string } {
  return (
    device.trustedUntil !== undefined &&
    Date.parse(device.trustedUntil) > now.getTime() &&
    device.trustedTokenVersion === account.tokenVersion &&
    device.trustedMfaVersion === (account.mfaFactorVersion ?? 0)
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

    return device && isDeviceTrustActive(device, user, this.now())
      ? { trustedUntil: device.trustedUntil }
      : null;
  }

  /**
   * Registers the device by its cookie and trusts it for the configured TTL,
   * in one write, at the account versions `user` was read with. A factor
   * change after that read makes the grant void rather than racing it. A
   * client that presented no device cookie, or sent no device id for the row
   * and its sessions to share, gets nothing.
   */
  async trust(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId: string | undefined,
    audit?: AuthAuditContext,
  ): Promise<DeviceTrustGrant | null> {
    const bindingId = client.deviceBinding?.id;

    if (!bindingId || !deviceId) {
      return null;
    }

    const userId = asUuid(user.id);
    const trustedUntil = new Date(
      this.now().getTime() + this.getTtlDays() * DAY_IN_MS,
    );

    await this.deviceRepository.registerKnownDevice({
      userId,
      deviceId,
      type: client.device.type,
      platform: client.device.platform,
      userAgent: client.device.userAgent,
      ipAddress: client.ip,
      bindingId,
      trust: {
        trustedUntil,
        tokenVersion: user.tokenVersion,
        mfaFactorVersion: user.mfaFactorVersion ?? 0,
      },
    });
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

  /**
   * "Stop trusting" from the device list. Stale trust (lapsed, or ended by a
   * token or factor version change) is cleared too, but only trust that was
   * still in force counts as revoked and is audited.
   */
  async revoke(
    user: AuthUserRecord,
    deviceId: string,
    audit?: AuthAuditContext,
  ): Promise<boolean> {
    const userId = asUuid(user.id);
    const previous = await this.deviceRepository.revokeTrust(userId, deviceId);

    if (!previous) {
      throw new BadRequestError("Known device could not be found.");
    }

    const revoked = isDeviceTrustActive(previous, user, this.now());

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
   * Audits trust a passkey or authenticator change ended. The change cleared
   * it in its own transaction (see `recordStrongFactorChange`); `count` is
   * how many devices had trust in force.
   */
  async recordFactorChangeRevocation(
    userId: string,
    reason: DeviceTrustRevocationReason,
    count: number,
    audit?: AuthAuditContext,
  ): Promise<void> {
    if (count < 1) {
      return;
    }

    await this.authAuditService.recordSafely({
      eventType: "device.trust_revoked",
      outcome: "success",
      userId: asUuid(userId),
      context: audit,
      metadata: { reason, scope: "all", count },
    });
  }
}
