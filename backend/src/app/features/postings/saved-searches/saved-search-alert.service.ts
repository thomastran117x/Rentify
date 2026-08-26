import { loggerFactory, type Logger } from "@/configuration/logging";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { EmailService } from "@/features/email/email.service";
import type { PostingsService } from "@/features/postings/postings.service";
import type { SavedSearchesRepository } from "@/features/postings/saved-searches/saved-searches.repository";
import {
  SAVED_SEARCH_SEEN_CAP,
  collectSavedSearchMatchIds,
  savedSearchQueryParamsSchema,
  type DueSavedSearch,
} from "@/features/postings/saved-searches/saved-searches.model";

export interface SavedSearchAlertSweepConfig {
  batchSize: number;
  /** How long an `instant` search waits between sweeps. */
  instantIntervalMs: number;
  /** How long a `daily` search waits between sweeps. */
  dailyIntervalMs: number;
}

/**
 * Replays due saved searches and alerts their owners about matches the search
 * has not reported before.
 *
 * Everything about *what* matches is delegated to `PostingsService.searchPublic`
 * — the same call the browse page makes. There is deliberately no second
 * matching implementation here: geo radius, availability windows and attribute
 * filters are subtle enough that a parallel evaluator would drift from the real
 * search within a release or two, and the visitor would never see the
 * difference until they got an email about a posting that does not match.
 */
export class SavedSearchAlertService {
  private readonly logger: Logger = loggerFactory.forComponent(
    "saved-search-alert.service",
    "service",
  );

  constructor(
    private readonly savedSearchesRepository: SavedSearchesRepository,
    private readonly postingsService: PostingsService,
    private readonly usersRepository: UsersRepository,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Processes one batch of due searches and returns how many were handled, so
   * the polling runtime drains a backlog at full speed and sleeps only once a
   * sweep comes up empty.
   */
  async runSweep(config: SavedSearchAlertSweepConfig): Promise<number> {
    const claimedAt = new Date();
    // Every claimed search is pushed out by the shorter of the two intervals
    // and then corrected per-row below. Claiming with the longer one would
    // delay instant searches by a day if the correction failed.
    const provisionalNextCheckAt = new Date(
      claimedAt.getTime() + config.instantIntervalMs,
    );

    const dueSearches = await this.savedSearchesRepository.claimDueSearches(
      claimedAt,
      provisionalNextCheckAt,
      config.batchSize,
    );

    if (dueSearches.length === 0) {
      return 0;
    }

    let alertedCount = 0;

    for (const search of dueSearches) {
      try {
        if (search.notifyFrequency === "daily") {
          await this.savedSearchesRepository.update(search.id, search.userId, {
            nextCheckAt: new Date(claimedAt.getTime() + config.dailyIntervalMs),
          });
        }

        if (await this.processSearch(search, claimedAt)) {
          alertedCount += 1;
        }
      } catch (error) {
        // One broken search must not abandon the rest of the batch. The claim
        // already moved this row forward, so it retries on its next turn.
        this.logger.error("Saved search sweep failed for one search.", {
          savedSearchId: search.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (alertedCount > 0) {
      this.logger.info("Saved search alerts enqueued.", {
        claimedCount: dueSearches.length,
        alertedCount,
      });
    }

    // The claimed count, not the alerted count: a batch of searches that all
    // found nothing is still work done, and returning 0 would put the runtime
    // to sleep with a backlog still due.
    return dueSearches.length;
  }

  /** Returns true when the search produced an alert. */
  private async processSearch(
    search: DueSavedSearch,
    checkedAt: Date,
  ): Promise<boolean> {
    const parsed = savedSearchQueryParamsSchema.safeParse(search.queryParams);

    if (!parsed.success) {
      // A filter the search was saved with no longer exists. Retrying cannot
      // fix that, so the search is retired from the sweep and flagged for the
      // visitor to recreate rather than silently never alerting again.
      this.logger.warn("Saved search filters are no longer valid.", {
        savedSearchId: search.id,
      });
      await this.savedSearchesRepository.markInvalidated(search.id, checkedAt);
      return false;
    }

    const matchIds = await collectSavedSearchMatchIds(parsed.data, (input) =>
      this.postingsService.searchPublic(input),
    );
    const newMatchIds =
      await this.savedSearchesRepository.filterUnseenPostingIds(
        search.id,
        matchIds,
      );

    if (newMatchIds.length === 0) {
      return false;
    }

    const recipient = await this.usersRepository.findUserById(search.userId);

    if (!recipient || !recipient.emailVerified) {
      // No verified address to alert. The matches are still recorded as seen
      // so that verifying an address later does not trigger a backlog email
      // about postings the visitor has had the chance to browse all along.
      await this.recordSeen(search.id, newMatchIds);
      return false;
    }

    // Enqueued before the seen rows are written, deliberately. A crash between
    // the two re-alerts on the next sweep, which is a duplicate email; the
    // other order would drop the alert entirely and the visitor would never
    // learn the posting existed. The composer re-checks every posting at send
    // time, so a duplicate is at least still accurate.
    await this.emailService.sendSavedSearchMatchesEmail({
      savedSearchId: search.id,
      recipientId: search.userId,
      postingIds: newMatchIds,
      occurredAt: checkedAt.toISOString(),
    });

    await this.recordSeen(search.id, newMatchIds);
    await this.savedSearchesRepository.recordAlert(
      search.id,
      checkedAt,
      newMatchIds.length,
    );

    return true;
  }

  private async recordSeen(
    savedSearchId: string,
    postingIds: string[],
  ): Promise<void> {
    await this.savedSearchesRepository.recordSeenPostings(
      savedSearchId,
      postingIds,
    );
    await this.savedSearchesRepository.pruneSeenPostings(
      savedSearchId,
      SAVED_SEARCH_SEEN_CAP,
    );
  }
}
