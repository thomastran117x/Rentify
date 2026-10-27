import type { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  AuthAuditActivityRow,
  RecordAuthAuditEventInput,
} from "@/features/auth/audit/auth-audit.model";
import type { AuthAuditAdminRow } from "@/features/auth/audit/auth-audit-admin.model";
import { newUuid, type Uuid } from "@/configuration/validation/uuid";

const COLUMN_LIMITS = {
  ipAddress: 45,
  userAgent: 512,
  deviceId: 64,
  sessionId: 64,
  requestId: 64,
} as const;

function truncate(value: string | undefined, limit: number): string | null {
  return value ? value.slice(0, limit) : null;
}

export interface ListAuthAuditEventsForUserInput {
  userId: Uuid;
  eventTypes?: readonly string[];
  outcome?: string;
  /** Id of the last event already returned; the page starts after it. */
  afterId?: string;
  /** Inclusive lower bound on created_at. */
  createdFrom?: Date;
  /** Exclusive upper bound on created_at. */
  createdBefore?: Date;
  limit: number;
}

/**
 * An administrator's search. Each equality filter is the leading column of an
 * index that ends in created_at, and the range is always bounded, so MySQL
 * can serve the search from whichever index is most selective.
 */
export interface ListAuthAuditEventsForAdminInput {
  userId?: Uuid;
  identifierHash?: string;
  ipAddress?: string;
  eventTypes?: readonly string[];
  outcome?: string;
  flagged?: boolean;
  afterId?: string;
  /** Inclusive lower bound on created_at. */
  createdFrom: Date;
  /** Exclusive upper bound on created_at. */
  createdBefore: Date;
  limit: number;
}

/**
 * One kind of event a detection rule counts. `triggeredLockout` keeps only the
 * `login.locked` attempt that set a lock, whose metadata has `triggered: true`,
 * not the refusals recorded while the lock lasts.
 */
export interface AuthAuditEventMatch {
  eventType: string;
  outcome?: string;
  triggeredLockout?: boolean;
}

/**
 * The events a detection rule fired on: those matching any of `matches`. Each
 * lookup leads with the user or the IP address, so it is served by
 * `(user_id, created_at)` or `(ip_address, created_at)`.
 */
export interface FindRecentAuthAuditEventIdsInput {
  userId?: Uuid;
  ipAddress?: string;
  /** Only events written while serving this request. */
  requestId?: string;
  matches: readonly AuthAuditEventMatch[];
  /** Inclusive lower bound on created_at. */
  createdFrom: Date;
  limit: number;
}

export interface CountAuthAuditEventsForUserInput {
  userId: Uuid;
  eventTypes: readonly string[];
  /** Inclusive lower bound on created_at. */
  createdFrom: Date;
}

const ACTIVITY_COLUMNS = {
  id: true,
  userId: true,
  actorUserId: true,
  eventType: true,
  outcome: true,
  reasonCode: true,
  method: true,
  ipAddress: true,
  userAgent: true,
  deviceId: true,
  sessionId: true,
  createdAt: true,
} as const;

const ADMIN_COLUMNS = {
  ...ACTIVITY_COLUMNS,
  requestId: true,
  metadata: true,
  flagged: true,
} as const;

export class AuthAuditRepository extends BaseRepository {
  /**
   * Inserts one event. Client-supplied values are cut to their column widths
   * rather than rejected: an over-long user agent or device id must not cost
   * the event. No retries, so an outage costs a sign-in one failed round trip
   * rather than the default retry budget.
   */
  async create(input: RecordAuthAuditEventInput): Promise<void> {
    const context = input.context ?? {};

    await this.executeAsync(
      () =>
        this.prisma.authAuditEvent.create({
          data: {
            id: input.id ?? newUuid(),
            userId: input.userId ?? null,
            actorUserId: input.actorUserId ?? null,
            eventType: input.eventType,
            outcome: input.outcome,
            reasonCode: input.reasonCode ?? null,
            method: input.method ?? null,
            identifierHash: input.identifierHash ?? null,
            ipAddress: truncate(context.ipAddress, COLUMN_LIMITS.ipAddress),
            userAgent: truncate(context.userAgent, COLUMN_LIMITS.userAgent),
            deviceId: truncate(context.deviceId, COLUMN_LIMITS.deviceId),
            sessionId: truncate(input.sessionId, COLUMN_LIMITS.sessionId),
            requestId: truncate(context.requestId, COLUMN_LIMITS.requestId),
            metadata: input.metadata,
            flagged: input.flagged ?? false,
          },
        }),
      { maxRetries: 0 },
    );
  }

  /**
   * The oldest ids created before the cutoff, served by the created_at index.
   * A plain read takes no locks, so a sign-in writing a new row is never held
   * up by a prune.
   */
  async listIdsCreatedBefore(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.authAuditEvent.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
    );

    return rows.map((row) => row.id);
  }

  /**
   * Deletes the listed rows that are still older than the cutoff and returns
   * how many went. Another replica may have deleted some of them already;
   * those are not counted, and that is not an error.
   */
  async deleteByIds(ids: string[], cutoff: Date): Promise<number> {
    const result = await this.executeAsync(() =>
      this.prisma.authAuditEvent.deleteMany({
        where: { id: { in: ids }, createdAt: { lt: cutoff } },
      }),
    );

    return result.count;
  }

  /**
   * One user's events, newest first, served by the (user_id, created_at)
   * index, or null when `afterId` is not one of this user's events under
   * these same filters.
   */
  async listForUser(
    input: ListAuthAuditEventsForUserInput,
  ): Promise<AuthAuditActivityRow[] | null> {
    return this.listPage(
      this.activityWhere(input),
      ACTIVITY_COLUMNS,
      input.afterId,
      input.limit,
    );
  }

  /**
   * Events matching an administrator's filters across every user, newest
   * first, or null when `afterId` is not an event under these same filters.
   */
  async listForAdmin(
    input: ListAuthAuditEventsForAdminInput,
  ): Promise<AuthAuditAdminRow[] | null> {
    const where: Prisma.AuthAuditEventWhereInput = {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.identifierHash ? { identifierHash: input.identifierHash } : {}),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.eventTypes ? { eventType: { in: [...input.eventTypes] } } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.flagged !== undefined ? { flagged: input.flagged } : {}),
      createdAt: { gte: input.createdFrom, lt: input.createdBefore },
    };

    return this.listPage(where, ADMIN_COLUMNS, input.afterId, input.limit);
  }

  /** The newest matching event ids, for a detection rule to flag. */
  async findRecentEventIds(
    input: FindRecentAuthAuditEventIdsInput,
  ): Promise<string[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.authAuditEvent.findMany({
        where: {
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          createdAt: { gte: input.createdFrom },
          OR: input.matches.map((match) => ({
            eventType: match.eventType,
            ...(match.outcome ? { outcome: match.outcome } : {}),
            ...(match.triggeredLockout
              ? { metadata: { path: "$.triggered", equals: true } }
              : {}),
          })),
        },
        select: { id: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
      }),
    );

    return rows.map((row) => row.id);
  }

  /** Marks events as flagged by suspicious-activity detection. */
  async flagEvents(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const result = await this.executeAsync(() =>
      this.prisma.authAuditEvent.updateMany({
        where: { id: { in: [...ids] }, flagged: false },
        data: { flagged: true },
      }),
    );

    return result.count;
  }

  /** How many of one user's events of these types happened since a time. */
  async countForUser(input: CountAuthAuditEventsForUserInput): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.authAuditEvent.count({
        where: {
          userId: input.userId,
          eventType: { in: [...input.eventTypes] },
          createdAt: { gte: input.createdFrom },
        },
      }),
    );
  }

  /**
   * One page, newest first, or null when `afterId` is not a row under `where`.
   *
   * Paging uses Prisma's cursor, which compares against the cursor row's
   * stored values in SQL, so created_at keeps its microseconds and events
   * sharing a millisecond are neither skipped nor repeated. Prisma finds
   * that row by id alone, though, and `skip: 1` then drops whichever row
   * comes first. A cursor naming a row the filters exclude, such as another
   * user's event, would therefore drop a row the caller never saw. The
   * cursor row is checked against the same filters first to rule that out.
   */
  private async listPage<TSelect extends Prisma.AuthAuditEventSelect>(
    where: Prisma.AuthAuditEventWhereInput,
    select: TSelect,
    afterId: string | undefined,
    limit: number,
  ): Promise<Prisma.AuthAuditEventGetPayload<{ select: TSelect }>[] | null> {
    if (afterId) {
      const cursorRow = await this.executeAsync(() =>
        this.prisma.authAuditEvent.findFirst({
          where: { ...where, id: afterId },
          select: { id: true },
        }),
      );

      if (!cursorRow) {
        return null;
      }
    }

    return this.executeAsync(
      () =>
        this.prisma.authAuditEvent.findMany({
          where,
          select,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit,
          ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
        }) as Promise<Prisma.AuthAuditEventGetPayload<{ select: TSelect }>[]>,
    );
  }

  private activityWhere(
    input: ListAuthAuditEventsForUserInput,
  ): Prisma.AuthAuditEventWhereInput {
    return {
      userId: input.userId,
      ...(input.eventTypes ? { eventType: { in: [...input.eventTypes] } } : {}),
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.createdFrom || input.createdBefore
        ? {
            createdAt: {
              ...(input.createdFrom ? { gte: input.createdFrom } : {}),
              ...(input.createdBefore ? { lt: input.createdBefore } : {}),
            },
          }
        : {}),
    };
  }
}
