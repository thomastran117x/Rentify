import type { EmailService } from "@/features/email/email.service";
import { savedSearchParamsSchema } from "@/features/saved-searches/saved-searches.model";
import type {
  PostingAlertCandidate,
  SavedSearchesRepository,
  SavedSearchWithUser,
} from "@/features/saved-searches/saved-searches.repository";

const CANDIDATE_FETCH_LIMIT = 20;
const MAX_POSTINGS_PER_EMAIL = 5;

export class SavedSearchAlertService {
  constructor(
    private readonly savedSearchesRepository: SavedSearchesRepository,
    private readonly emailService: EmailService,
  ) {}

  async processBatch(batchSize: number): Promise<number> {
    const batch = await this.savedSearchesRepository.findAlertBatch(
      null,
      batchSize,
    );

    if (batch.length === 0) {
      return 0;
    }

    for (const savedSearch of batch) {
      await this.processOne(savedSearch);
    }

    return batch.length;
  }

  private async processOne(savedSearch: SavedSearchWithUser): Promise<void> {
    const paramsResult = savedSearchParamsSchema.safeParse(
      savedSearch.searchParams,
    );

    if (!paramsResult.success) {
      return;
    }

    const params = paramsResult.data;
    const publishedSince =
      savedSearch.lastAlertSentAt ?? savedSearch.createdAt;

    const candidates = await this.savedSearchesRepository.findNewMatchingPostings(
      params,
      publishedSince,
      CANDIDATE_FETCH_LIMIT,
    );

    const matched = this.applyInMemoryFilters(candidates, params).slice(
      0,
      MAX_POSTINGS_PER_EMAIL,
    );

    if (matched.length === 0) {
      return;
    }

    await this.emailService.sendSavedSearchAlertEmail({
      to: savedSearch.user.email,
      firstName: savedSearch.user.firstName ?? undefined,
      searchName: savedSearch.name,
      postings: matched.map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        postingPath: `/postings/${p.id}`,
      })),
    });

    await this.savedSearchesRepository.markAlertSent(
      savedSearch.id,
      new Date(),
    );
  }

  private applyInMemoryFilters(
    postings: PostingAlertCandidate[],
    params: ReturnType<typeof savedSearchParamsSchema.parse>,
  ): PostingAlertCandidate[] {
    return postings.filter((p) => {
      if (params.tags?.length) {
        const postingTags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
        if (!params.tags.every((t) => postingTags.includes(t))) {
          return false;
        }
      }

      const pricing = p.pricing as Record<string, unknown> | null;
      const daily =
        pricing && typeof pricing["daily"] === "number"
          ? pricing["daily"]
          : undefined;

      if (
        params.minDailyPrice !== undefined &&
        (daily === undefined || daily < params.minDailyPrice)
      ) {
        return false;
      }

      if (
        params.maxDailyPrice !== undefined &&
        (daily === undefined || daily > params.maxDailyPrice)
      ) {
        return false;
      }

      return true;
    });
  }
}
