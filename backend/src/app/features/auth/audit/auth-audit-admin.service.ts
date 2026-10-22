import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  invalidCursorError,
  parseUserAgent,
} from "@/features/auth/audit/auth-audit-activity";
import {
  collectReferencedUserIds,
  resolveAdminAuditRange,
  toAdminAuthAuditEvent,
  toAdminRepositoryFilter,
  toAuditViewedMetadata,
} from "@/features/auth/audit/auth-audit-admin";
import {
  ADMIN_AUTH_AUDIT_MAX_RANGE_MS,
  ADMIN_USER_SECURITY_RECENT_EVENTS,
  FAILED_SIGN_IN_EVENT_TYPES,
  type AdminAuditReader,
  type AdminAuditSubjectFilter,
  type AdminAuthAuditEvent,
  type AdminAuthAuditEventList,
  type AdminAuthAuditQuery,
  type AdminUserLockoutState,
  type AdminUserSecuritySummary,
  type AuthAuditAdminRow,
} from "@/features/auth/audit/auth-audit-admin.model";
import type { DeviceRepository } from "@/features/auth/device/device.repository";
import {
  LOCAL_LOGIN_LOCK_TTL_IN_SECONDS,
  type LoginLockoutService,
} from "@/features/auth/lockout/login-lockout.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Lets administrators investigate sign-in activity across every account.
 * Every read first records an `admin.audit_viewed` event and fails if that
 * write fails, so there is no way to look at someone's security history
 * without leaving a trace.
 *
 * The event's subject stays null, which keeps an administrator's reads out
 * of the subject's own security activity page; the reader is the actor, and
 * a summary read names its target in the metadata.
 */
export class AuthAuditAdminService {
  constructor(
    private readonly repository: AuthAuditRepository,
    private readonly authAuditService: AuthAuditService,
    private readonly usersRepository: UsersRepository,
    private readonly deviceRepository: DeviceRepository,
    private readonly loginLockoutService: LoginLockoutService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listEvents(
    query: AdminAuthAuditQuery,
    reader: AdminAuditReader,
  ): Promise<AdminAuthAuditEventList> {
    const afterId = query.cursor
      ? decodeActivityCursor(query.cursor)
      : undefined;
    const range = resolveAdminAuditRange(query, this.now());
    const subject = await this.resolveSubject(query);

    await this.recordView(reader, toAuditViewedMetadata(query, range));

    const rows = await this.repository.listForAdmin(
      toAdminRepositoryFilter(query, subject, range, afterId),
    );

    if (!rows) {
      throw invalidCursorError();
    }

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: await this.toEvents(page),
      nextCursor:
        rows.length > query.limit && last
          ? encodeActivityCursor(last.id)
          : null,
      range: {
        from: range.createdFrom.toISOString(),
        to: range.createdBefore.toISOString(),
      },
    };
  }

  async getUserSecuritySummary(
    userId: Uuid,
    reader: AdminAuditReader,
  ): Promise<AdminUserSecuritySummary> {
    const user = await this.usersRepository.findSecurityProfile(userId);

    if (!user) {
      throw new ResourceNotFoundError("User not found.");
    }

    await this.recordView(reader, {
      view: "user_summary",
      target_user_id: userId,
    });

    const now = this.now();
    const [last24Hours, last7Days, lockout, devices, rows] = await Promise.all([
      this.repository.countForUser({
        userId,
        eventTypes: FAILED_SIGN_IN_EVENT_TYPES,
        createdFrom: new Date(now.getTime() - DAY_IN_MS),
      }),
      this.repository.countForUser({
        userId,
        eventTypes: FAILED_SIGN_IN_EVENT_TYPES,
        createdFrom: new Date(now.getTime() - 7 * DAY_IN_MS),
      }),
      this.getLockoutState(user.username),
      this.deviceRepository.listKnownDevices(userId),
      this.repository.listForAdmin({
        userId,
        createdFrom: new Date(now.getTime() - ADMIN_AUTH_AUDIT_MAX_RANGE_MS),
        createdBefore: now,
        limit: ADMIN_USER_SECURITY_RECENT_EVENTS,
      }),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      accountStatus: "active",
      lastLoginAt: user.lastLoginAt,
      failedSignIns: { last24Hours, last7Days },
      lockout,
      devices: devices.map((device) => {
        const { browser, os } = parseUserAgent(device.userAgent);

        return {
          id: device.id,
          deviceId: device.deviceId,
          type: device.type,
          platform: device.platform ?? null,
          browser,
          os,
          lastIpAddress: device.lastIpAddress ?? null,
          firstSeenAt: device.firstSeenAt,
          lastSeenAt: device.lastSeenAt,
        };
      }),
      recentEvents: await this.toEvents(rows ?? []),
    };
  }

  /**
   * An email resolves by email and anything else by username. An identifier
   * that matches no account falls back to its keyed hash, which every sign-in
   * and unlock event records, so attempts against an unknown username can
   * still be found.
   */
  private async resolveSubject(
    query: Pick<AdminAuthAuditQuery, "userId" | "user">,
  ): Promise<AdminAuditSubjectFilter> {
    if (query.userId) {
      return { kind: "user", userId: query.userId };
    }

    if (!query.user) {
      return { kind: "none" };
    }

    const userId = query.user.includes("@")
      ? await this.usersRepository.findUserIdByEmail(query.user)
      : await this.usersRepository.findUserIdByUsername(query.user);

    return userId
      ? { kind: "user", userId: asUuid(userId) }
      : {
          kind: "identifier",
          identifierHash: this.authAuditService.hashIdentifier(query.user),
        };
  }

  /**
   * The live Redis record sign-in reads, keyed by username. An account with
   * no username cannot sign in with a password, so it is never locked.
   */
  private async getLockoutState(
    username: string | null,
  ): Promise<AdminUserLockoutState> {
    const record = username
      ? await this.loginLockoutService.getAttemptRecord(username)
      : null;

    if (!record) {
      return {
        locked: false,
        failedAttempts: 0,
        lockedAt: null,
        lockedUntil: null,
      };
    }

    const lockedUntil = record.lockedAt
      ? new Date(
          Date.parse(record.lockedAt) + LOCAL_LOGIN_LOCK_TTL_IN_SECONDS * 1000,
        ).toISOString()
      : null;

    return {
      locked: Boolean(record.lockedAt),
      failedAttempts: record.failedAttempts,
      lockedAt: record.lockedAt ?? null,
      lockedUntil,
    };
  }

  private async recordView(
    reader: AdminAuditReader,
    metadata: Record<string, string | number>,
  ): Promise<void> {
    await this.authAuditService.record({
      eventType: "admin.audit_viewed",
      outcome: "success",
      userId: null,
      actorUserId: reader.userId,
      context: reader.context,
      metadata,
    });
  }

  private async toEvents(
    rows: readonly AuthAuditAdminRow[],
  ): Promise<AdminAuthAuditEvent[]> {
    const summaries = await this.usersRepository.listIdentitySummariesByIds(
      collectReferencedUserIds(rows),
    );
    const usersById = new Map(summaries.map((user) => [user.id, user]));

    return rows.map((row) => toAdminAuthAuditEvent(row, usersById));
  }
}
