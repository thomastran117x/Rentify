import type { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";

const MILLISECONDS_PER_DAY = 86_400_000;

export interface AuthAuditPruneOptions {
  retentionDays: number;
  batchSize: number;
}

export interface AuthAuditPruneSummary {
  cutoff: Date;
  deleted: number;
  batches: number;
}

/**
 * Deletes auth audit events older than the retention period. They hold IP
 * addresses and user agents, which are kept only as long as abuse
 * investigation needs them.
 *
 * Each batch lists the oldest ids past the cutoff and deletes them by id, so
 * replicas pruning at the same time only race to delete the same rows: the
 * loser deletes nothing and carries on. A database error ends the run; the
 * rows already deleted stay deleted and the next run picks up from there.
 */
export class AuthAuditRetentionService {
  constructor(
    private readonly repository: AuthAuditRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  computeCutoff(retentionDays: number): Date {
    return new Date(
      this.now().getTime() - retentionDays * MILLISECONDS_PER_DAY,
    );
  }

  async prune(options: AuthAuditPruneOptions): Promise<AuthAuditPruneSummary> {
    const cutoff = this.computeCutoff(options.retentionDays);
    let deleted = 0;
    let batches = 0;

    for (;;) {
      const ids = await this.repository.listIdsCreatedBefore(
        cutoff,
        options.batchSize,
      );

      if (ids.length === 0) {
        break;
      }

      deleted += await this.repository.deleteByIds(ids, cutoff);
      batches += 1;

      // A short batch was the last of the rows past the cutoff.
      if (ids.length < options.batchSize) {
        break;
      }
    }

    return { cutoff, deleted, batches };
  }
}
