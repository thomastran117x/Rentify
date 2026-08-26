import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsService } from "@/features/postings/postings.service";
import type { SavedSearchesRepository } from "@/features/postings/saved-searches/saved-searches.repository";
import {
  MAX_ALERT_MATCHES_PER_EMAIL,
  collectSavedSearchMatchIds,
  savedSearchQueryParamsSchema,
  toSavedSearchMatchPreview,
  type SavedSearchMatchPreview,
  type SavedSearchQueryParams,
} from "@/features/postings/saved-searches/saved-searches.model";

export interface ComposeSavedSearchMatchesEmailInput {
  savedSearchId: string;
  recipientId: string;
  postingIds: string[];
  occurredAt: string;
}

export interface SavedSearchMatchesEmailContent {
  to: string;
  firstName?: string;
  savedSearchId: string;
  savedSearchName: string;
  /** The filters, so the email can link straight back to the live results. */
  queryParams: SavedSearchQueryParams;
  matches: SavedSearchMatchPreview[];
  /** Matches beyond the ones named individually. */
  additionalMatchCount: number;
}

/**
 * Hydrates a saved-search alert from the identifiers carried on the queue job.
 *
 * Returns `null` whenever the alert has stopped being true, so the worker
 * acknowledges the job instead of retrying it to the dead-letter queue. This
 * matters here because the sweep enqueues before it records the matches as
 * seen: a crash in between re-alerts on the next pass, and the re-check below
 * is what keeps that duplicate honest rather than announcing postings that
 * have since been paused or removed.
 */
export class SavedSearchEmailComposer {
  constructor(
    private readonly savedSearchesRepository: SavedSearchesRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly usersRepository: UsersRepository,
    private readonly postingsService: PostingsService,
  ) {}

  async compose(
    input: ComposeSavedSearchMatchesEmailInput,
  ): Promise<SavedSearchMatchesEmailContent | null> {
    const search = await this.savedSearchesRepository.findById(
      input.savedSearchId,
    );

    if (!search) {
      return null;
    }

    // The visitor may have turned alerts off, or handed the search to nobody
    // by deleting their account, while the job waited behind a retry.
    if (
      search.notifyFrequency === "off" ||
      search.userId !== input.recipientId
    ) {
      return null;
    }

    const parsedParams = savedSearchQueryParamsSchema.safeParse(
      search.queryParams,
    );

    if (!parsedParams.success) {
      return null;
    }

    // Re-read rather than trusting the job: `getPublicByIds` reports anything
    // that has dropped out of the public projection since the sweep ran, which
    // is exactly the set that must not appear in the email.
    const batch = await this.postingsPublicCacheService.getPublicByIds(
      input.postingIds,
    );

    if (batch.postings.length === 0) {
      return null;
    }

    // Still visible is not the same as still matching. A posting can stay
    // public while its price, tags, policy or availability change, and a job
    // waiting behind a retry has had time for that to happen. Re-running the
    // saved filters and intersecting keeps the email from announcing a match
    // that has stopped being one.
    const matchingIds = new Set(
      await collectSavedSearchMatchIds(parsedParams.data, (searchInput) =>
        this.postingsService.searchPublic(searchInput),
      ),
    );
    const matches = batch.postings.filter((posting) =>
      matchingIds.has(posting.id),
    );

    if (matches.length === 0) {
      return null;
    }

    const recipient = await this.usersRepository.findUserById(
      input.recipientId,
    );

    if (!recipient?.email || !recipient.emailVerified) {
      return null;
    }

    return {
      to: recipient.email,
      ...(recipient.firstName ? { firstName: recipient.firstName } : {}),
      savedSearchId: search.id,
      savedSearchName: search.name,
      queryParams: parsedParams.data,
      matches: matches
        .slice(0, MAX_ALERT_MATCHES_PER_EMAIL)
        .map(toSavedSearchMatchPreview),
      additionalMatchCount: Math.max(
        0,
        matches.length - MAX_ALERT_MATCHES_PER_EMAIL,
      ),
    };
  }
}
