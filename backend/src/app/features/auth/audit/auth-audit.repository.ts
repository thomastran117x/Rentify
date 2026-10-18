import { BaseRepository } from "@/features/base/base.repository";
import type {
  AuthAuditActivityRow,
  RecordAuthAuditEventInput,
} from "@/features/auth/audit/auth-audit.model";
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
  /** Id of the last event already returned; the page starts after it. */
  afterId?: string;
  limit: number;
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
            id: newUuid(),
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
   * index. Paging uses Prisma's cursor, which compares against the cursor
   * row's stored values in SQL, so created_at keeps its microseconds and
   * events sharing a millisecond are neither skipped nor repeated. Prisma
   * applies the filter to the cursor row too, so a cursor naming another
   * user's event, or one since pruned, yields an empty page.
   */
  async listForUser(
    input: ListAuthAuditEventsForUserInput,
  ): Promise<AuthAuditActivityRow[]> {
    return this.executeAsync(() =>
      this.prisma.authAuditEvent.findMany({
        where: {
          userId: input.userId,
          ...(input.eventTypes
            ? { eventType: { in: [...input.eventTypes] } }
            : {}),
        },
        select: ACTIVITY_COLUMNS,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        ...(input.afterId ? { cursor: { id: input.afterId }, skip: 1 } : {}),
      }),
    );
  }
}
