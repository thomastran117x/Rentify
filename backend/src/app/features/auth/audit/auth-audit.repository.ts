import { BaseRepository } from "@/features/base/base.repository";
import type { RecordAuthAuditEventInput } from "@/features/auth/audit/auth-audit.model";
import { newUuid } from "@/configuration/validation/uuid";

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
}
