import { loggerFactory } from "@/configuration/logging";
import type { CacheService } from "@/features/cache/cache.service";
import { flowLockKeys, withFlowLock } from "@/features/cache/cache-locks";
import type { EmailService } from "@/features/email/email.service";
import { createAuditChanges } from "@/features/organizations/organization-audit.model";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import type { OrganizationsRepository } from "@/features/organizations/organizations.repository";
import type { PostingExpiryCandidate } from "@/features/postings/postings.model";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Sweeps postings whose owner-set expiry date has arrived.
 *
 * Kept separate from PostingsService deliberately. Every lifecycle method there
 * opens with `requireManagedPosting(id, actorUserId, "write")`, and a worker has
 * no user to supply; threading a nullable actor through those guards would
 * weaken the authorization path of the most-used methods in the codebase to
 * serve one caller that is not a user at all.
 */
export class PostingExpiryService {
  private readonly logger = loggerFactory.forClass(
    PostingExpiryService,
    "service",
  );

  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly cacheService: CacheService,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Pauses every published posting whose expiry date has passed.
   *
   * Returns how many candidates were examined so the polling runtime can keep
   * draining a backlog at full speed and only sleep once a pass comes up empty.
   */
  async expireDuePostings(limit: number): Promise<number> {
    const candidates =
      await this.postingsRepository.listPostingsDueForExpiry(limit);

    for (const candidate of candidates) {
      try {
        await this.expireCandidate(candidate);
      } catch (error) {
        // One posting failing must not abandon the rest of the batch; the next
        // poll will pick it up again because the row is still published and
        // still past its date.
        this.logger.error(
          "Failed to expire posting.",
          {
            postingId: candidate.id,
            organizationId: candidate.organizationId,
          },
          error,
        );
      }
    }

    return candidates.length;
  }

  private async expireCandidate(
    candidate: PostingExpiryCandidate,
  ): Promise<void> {
    await withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(candidate.id),
      async () => {
        const expired = await this.postingsRepository.expireIfDue(candidate.id);

        if (!expired) {
          // Somebody archived it, unpublished it or pushed the date out between
          // the sweep's read and this write. Nothing to announce.
          return;
        }

        await invalidatePublicPostingProjection(
          this.postingsPublicCacheService,
          expired.id,
        );
        await this.recordExpiryAudit(candidate, expired);

        this.logger.info("Posting expired and was paused.", {
          postingId: expired.id,
          organizationId: expired.organizationId,
          expiresAt: candidate.expiresAt,
        });
      },
      "This posting's booking availability is being modified. The expiry sweep will retry.",
    );
  }

  /**
   * Sends the single "expiring soon" reminder for postings entering the lead
   * window.
   */
  async sendDueExpiryReminders(
    limit: number,
    leadDays: number,
  ): Promise<number> {
    const windowEndsAt = new Date(Date.now() + leadDays * DAY_IN_MS);
    const candidates =
      await this.postingsRepository.listPostingsDueForExpiryReminder(
        limit,
        windowEndsAt,
      );

    for (const candidate of candidates) {
      try {
        await this.remindCandidate(candidate);
      } catch (error) {
        this.logger.error(
          "Failed to send posting expiry reminder.",
          {
            postingId: candidate.id,
            organizationId: candidate.organizationId,
          },
          error,
        );
      }
    }

    return candidates.length;
  }

  private async remindCandidate(
    candidate: PostingExpiryCandidate,
  ): Promise<void> {
    const recipientId =
      await this.organizationsRepository.findPrimaryManagerUserId(
        candidate.organizationId,
      );

    if (!recipientId) {
      // Stamp anyway. Leaving the latch open would re-select this orphaned row
      // on every poll for as long as it remains published. Still claimed
      // against the exact deadline, so an owner who moves the date in this
      // window keeps their reminder.
      await this.postingsRepository.markExpiryReminderSent(
        candidate.id,
        candidate.expiresAt,
      );
      this.logger.warn(
        "Skipped posting expiry reminder; the organization has no primary manager.",
        {
          postingId: candidate.id,
          organizationId: candidate.organizationId,
        },
      );
      return;
    }

    // Claim before enqueuing, not after. If the enqueue succeeded and the
    // process died before the stamp, the next poll would send a duplicate.
    // Stamping first makes the failure mode a missed reminder instead, and the
    // queue's own retry/dead-letter topology already covers transient publish
    // failures. For a courtesy notification, under-delivery beats double.
    const claimed = await this.postingsRepository.markExpiryReminderSent(
      candidate.id,
      candidate.expiresAt,
    );

    if (!claimed) {
      return;
    }

    await this.emailService.sendPostingExpiringSoonEmail({
      postingId: candidate.id,
      recipientId,
      expiresAt: candidate.expiresAt,
    });
  }

  private async recordExpiryAudit(
    candidate: PostingExpiryCandidate,
    after: unknown,
  ): Promise<void> {
    try {
      await this.organizationAuditService.record({
        organizationId: candidate.organizationId,
        // No actor: the sweeper is the system. `invitation.expired` records the
        // same way.
        actorUserId: null,
        action: "posting.expired",
        resourceType: "posting",
        resourceId: candidate.id,
        summary: `${candidate.name} reached its expiry date and was paused.`,
        changes: createAuditChanges(undefined, after),
        afterSnapshot: after,
        // Not restorable: a restored pre-expiry snapshot is published with the
        // same past date, so the sweeper would pause it again on the next poll
        // — a restore button that visibly undoes itself.
        restorable: false,
      });
    } catch (error) {
      this.logger.error(
        "Failed to record posting expiry audit entry.",
        {
          postingId: candidate.id,
          organizationId: candidate.organizationId,
        },
        error,
      );
    }
  }
}
