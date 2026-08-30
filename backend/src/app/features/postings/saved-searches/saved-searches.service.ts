import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import UnprocessableEntityError from "@/errors/http/unprocessable-entity.error";
import { loggerFactory, type Logger } from "@/configuration/logging";
import type { PostingsService } from "@/features/postings/postings.service";
import type { SavedSearchesRepository } from "@/features/postings/saved-searches/saved-searches.repository";
import {
  MAX_SAVED_SEARCHES_PER_USER,
  collectSavedSearchMatchIds,
  deriveSavedSearchName,
  hashSavedSearchParams,
  toSavedSearchRecord,
  type CreateSavedSearchRequest,
  type ListSavedSearchesResult,
  type SavedSearchNotifyFrequency,
  type SavedSearchQueryParams,
  type SavedSearchRecord,
  type UpdateSavedSearchRequest,
} from "@/features/postings/saved-searches/saved-searches.model";
import {
  asOptionalUuid,
  asUuid,
  type Uuid,
} from "@/configuration/validation/uuid";

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How soon after saving an `instant` search the first sweep may run. The
 * baseline has already recorded everything currently matching, so this is only
 * the delay before genuinely new postings can alert; a minute keeps a burst of
 * saves from all landing in the same sweep batch.
 */
const INSTANT_FIRST_CHECK_DELAY_MS = 60 * 1000;

export class SavedSearchesService {
  private readonly logger: Logger = loggerFactory.forComponent(
    "saved-searches.service",
    "service",
  );

  constructor(
    private readonly savedSearchesRepository: SavedSearchesRepository,
    private readonly postingsService: PostingsService,
  ) {}

  async create(
    userId: Uuid,
    body: CreateSavedSearchRequest,
  ): Promise<SavedSearchRecord> {
    const queryHash = hashSavedSearchParams(body.queryParams);
    const existing = await this.savedSearchesRepository.findByHash(
      userId,
      queryHash,
    );

    if (existing) {
      throw new ConflictError("You have already saved this search.");
    }

    const total = await this.savedSearchesRepository.countForUser(userId);

    if (total >= MAX_SAVED_SEARCHES_PER_USER) {
      throw new UnprocessableEntityError(
        `You can save up to ${MAX_SAVED_SEARCHES_PER_USER} searches. Delete one to save another.`,
      );
    }

    const row = await this.savedSearchesRepository.create({
      userId,
      name: body.name?.trim() || deriveSavedSearchName(body.queryParams),
      queryParams: body.queryParams,
      queryHash,
      notifyFrequency: body.notifyFrequency,
      nextCheckAt: this.resolveNextCheckAt(body.notifyFrequency, new Date()),
    });

    await this.baselineSeenPostings(asUuid(row.id), body.queryParams);

    return toSavedSearchRecord(row);
  }

  async list(
    userId: Uuid,
    page: number,
    pageSize: number,
  ): Promise<ListSavedSearchesResult> {
    const { rows, pagination } = await this.savedSearchesRepository.listPage(
      userId,
      page,
      pageSize,
    );

    return {
      searches: rows.map(toSavedSearchRecord),
      pagination,
      limit: MAX_SAVED_SEARCHES_PER_USER,
    };
  }

  async update(
    id: Uuid,
    userId: Uuid,
    body: UpdateSavedSearchRequest,
  ): Promise<SavedSearchRecord> {
    const row = await this.savedSearchesRepository.update(id, userId, {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.notifyFrequency !== undefined
        ? {
            notifyFrequency: body.notifyFrequency,
            // Turning alerts back on has to re-arm the sweep, and turning them
            // off has to disarm it, or a search would keep its old schedule.
            nextCheckAt: this.resolveNextCheckAt(
              body.notifyFrequency,
              new Date(),
            ),
          }
        : {}),
    });

    if (!row) {
      throw new ResourceNotFoundError("Saved search could not be found.");
    }

    return toSavedSearchRecord(row);
  }

  async remove(id: Uuid, userId: Uuid): Promise<void> {
    const removed = await this.savedSearchesRepository.remove(id, userId);

    if (!removed) {
      throw new ResourceNotFoundError("Saved search could not be found.");
    }
  }

  /**
   * Clears the new-match badge. Separate from `list` so the count survives a
   * page render the visitor never scrolled to, and only drops when they open
   * the results.
   */
  async markSeen(id: Uuid, userId: Uuid): Promise<void> {
    const reset = await this.savedSearchesRepository.resetNewMatchCount(
      id,
      userId,
    );

    if (!reset) {
      throw new ResourceNotFoundError("Saved search could not be found.");
    }
  }

  /**
   * Records everything the search matches right now as already alerted on.
   *
   * Without this, a search saved against a category with forty live postings
   * would email all forty on its first sweep — the visitor already saw those
   * results, which is why they were on the page to press save. Only the first
   * `SAVED_SEARCH_SEEN_CAP` matches are baselined; past that the search is
   * broad enough that the retention cap would have evicted the tail anyway.
   *
   * Failures are logged rather than thrown: the search is already saved, and
   * losing the baseline costs one over-eager email, not the feature.
   */
  private async baselineSeenPostings(
    savedSearchId: Uuid,
    queryParams: SavedSearchQueryParams,
  ): Promise<void> {
    try {
      const postingIds = await collectSavedSearchMatchIds(
        queryParams,
        (input) => this.postingsService.searchPublic(input),
      );

      await this.savedSearchesRepository.recordSeenPostings(
        asUuid(savedSearchId),
        postingIds,
      );
    } catch (error) {
      this.logger.warn("Saved search baseline could not be recorded.", {
        savedSearchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveNextCheckAt(
    frequency: SavedSearchNotifyFrequency,
    now: Date,
  ): Date | null {
    if (frequency === "off") {
      return null;
    }

    return new Date(
      now.getTime() +
        (frequency === "daily"
          ? DAILY_INTERVAL_MS
          : INSTANT_FIRST_CHECK_DELAY_MS),
    );
  }
}
