import {
  ElasticsearchCircuitOpenError,
  getElasticsearchClient,
  type ElasticsearchClient,
} from "@/configuration/resources/elasticsearch";
import {
  type BatchPostingsResult,
  MAX_SEARCH_RESULT_WINDOW,
  type PostingSearchSource,
  type PublicPostingRecord,
  type SearchAttributeFilterInput,
  type SearchPostingsInput,
  type SearchPostingsResult,
} from "@/features/postings/postings.model";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { SearchFallbackReason } from "@/features/search/search.model";
import { recordSearchFallback } from "@/features/search/search.telemetry";
import { loggerFactory, type Logger } from "@/configuration/logging";

interface SearchIdsResult {
  ids: string[];
  total: number;
  source: PostingSearchSource;
  fallbackReason?: SearchFallbackReason;
}

interface ElasticsearchSearchResponse {
  hits?: {
    total?: {
      value?: number;
    };
    hits?: Array<{
      _id: string;
    }>;
  };
}

export class PostingsPublicSearchService {
  private readonly logger: Logger;
  private static readonly queryTokenPattern = /[\p{L}\p{N}]+/gu;

  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly elasticsearch: ElasticsearchClient = getElasticsearchClient(),
  ) {
    this.logger = loggerFactory.forClass(
      PostingsPublicSearchService,
      "service",
    );
  }

  async searchPublic(
    input: SearchPostingsInput,
  ): Promise<SearchPostingsResult> {
    let searchIds = await this.searchIdsWithFallback(input);
    let batch = await this.hydratePublicPostings(searchIds.ids);

    if (searchIds.source === "elasticsearch" && batch.missingIds.length > 0) {
      this.logger.warn(
        "Postings search falling back to database because Elasticsearch returned stale ids.",
        {
          missingIds: batch.missingIds,
        },
      );
      searchIds = await this.searchIdsFromDatabase(input, "index-drift");
      batch = await this.hydratePublicPostings(searchIds.ids);
    }

    if (batch.missingIds.length > 0) {
      this.logger.warn(
        "Postings search returned unresolved public posting ids after hydration.",
        {
          source: searchIds.source,
          missingIds: batch.missingIds,
        },
      );
    }

    return {
      postings: batch.postings,
      pagination: this.createPagination(
        input.page,
        input.pageSize,
        searchIds.total,
      ),
      source: searchIds.source,
      ...(input.query ? { query: input.query } : {}),
    };
  }

  private async searchIdsWithFallback(
    input: SearchPostingsInput,
  ): Promise<SearchIdsResult> {
    if (this.elasticsearch.isEnabled()) {
      try {
        return await this.searchIdsInElasticsearch(input);
      } catch (error) {
        if (error instanceof ElasticsearchCircuitOpenError) {
          this.logger.info(
            "Postings search using database fallback because Elasticsearch circuit is open.",
          );
          return this.searchIdsFromDatabase(input, "circuit-open");
        }

        this.logger.warn(
          "Postings search falling back to database.",
          undefined,
          error,
        );
        return this.searchIdsFromDatabase(input, "es-unavailable");
      }
    }

    return this.searchIdsFromDatabase(input, "es-unavailable");
  }

  private async searchIdsInElasticsearch(
    input: SearchPostingsInput,
  ): Promise<SearchIdsResult> {
    const indexName = `${this.elasticsearch.getPostingsIndexName()}-read`;
    const from = (input.page - 1) * input.pageSize;
    const response =
      await this.elasticsearch.requestJson<ElasticsearchSearchResponse>(
        `/${encodeURIComponent(indexName)}/_search`,
        {
          method: "POST",
          body: JSON.stringify(this.buildSearchRequest(input, from)),
        },
      );
    const hits = response.hits?.hits ?? [];

    return {
      ids: hits.map((hit) => hit._id),
      total: response.hits?.total?.value ?? 0,
      source: "elasticsearch",
    };
  }

  private buildSearchRequest(
    input: SearchPostingsInput,
    from: number,
  ): Record<string, unknown> {
    const must: Array<Record<string, unknown>> = [];
    const filter: Array<Record<string, unknown>> = [
      {
        term: {
          status: "published",
        },
      },
    ];
    const mustNot: Array<Record<string, unknown>> = [];

    if (input.query) {
      const isMultiTermQuery = this.countQueryTerms(input.query) > 1;
      must.push({
        bool: {
          should: [
            {
              match_phrase: {
                name: {
                  query: input.query,
                  boost: 10,
                },
              },
            },
            {
              multi_match: {
                query: input.query,
                type: "cross_fields",
                operator: "and",
                fields: [
                  "name^7",
                  "tags.text^5",
                  "location.city^4",
                  "location.region^3",
                  "location.country^2",
                  "description^2",
                ],
              },
            },
            {
              multi_match: {
                query: input.query,
                fields: [
                  "name^5",
                  "tags.text^3",
                  "location.city^3",
                  "location.region^2",
                  "location.country^2",
                  "description",
                ],
                fuzziness: "AUTO",
                prefix_length: 1,
                ...(isMultiTermQuery ? { operator: "and" } : {}),
                boost: 0.7,
              },
            },
            {
              multi_match: {
                query: input.query,
                type: "bool_prefix",
                fields: [
                  "name.prefix^4",
                  "location.city.prefix^3",
                  "location.region.prefix^2",
                  "location.country.prefix^2",
                ],
                ...(isMultiTermQuery ? { operator: "and" } : {}),
                boost: 0.8,
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (input.family) {
      filter.push({
        term: {
          family: input.family,
        },
      });
    }

    if (input.subtype) {
      filter.push({
        term: {
          subtype: input.subtype,
        },
      });
    }

    if (input.tags && input.tags.length > 0) {
      filter.push({
        bool: {
          filter: input.tags.map((tag) => ({
            term: {
              tags: tag,
            },
          })),
        },
      });
    }

    if (input.availabilityStatus) {
      filter.push({
        term: {
          availabilityStatus: input.availabilityStatus,
        },
      });
    }

    for (const attributeFilter of input.attributeFilters ?? []) {
      filter.push(...this.buildAttributeFilters(attributeFilter));
    }

    if (
      input.minDailyPrice !== undefined ||
      input.maxDailyPrice !== undefined
    ) {
      filter.push({
        range: {
          dailyPriceAmount: {
            ...(input.minDailyPrice !== undefined
              ? { gte: input.minDailyPrice }
              : {}),
            ...(input.maxDailyPrice !== undefined
              ? { lte: input.maxDailyPrice }
              : {}),
          },
        },
      });
    }

    if (input.geo?.radiusKm !== undefined) {
      filter.push({
        geo_distance: {
          distance: `${input.geo.radiusKm}km`,
          geoPoint: {
            lat: input.geo.latitude,
            lon: input.geo.longitude,
          },
        },
      });
    }

    if (input.availabilityWindow) {
      mustNot.push({
        nested: {
          path: "blockedRanges",
          query: {
            bool: {
              filter: [
                {
                  range: {
                    "blockedRanges.startAt": {
                      lt: input.availabilityWindow.endAt,
                    },
                  },
                },
                {
                  range: {
                    "blockedRanges.endAt": {
                      gt: input.availabilityWindow.startAt,
                    },
                  },
                },
              ],
            },
          },
        },
      });
    }

    return {
      from,
      size: input.pageSize,
      query: {
        bool: {
          ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
          filter,
          ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
        },
      },
      sort: this.buildSort(input),
      track_total_hits: true,
    };
  }

  private countQueryTerms(query: string): number {
    return (
      query.match(PostingsPublicSearchService.queryTokenPattern)?.length ?? 0
    );
  }

  private buildSort(
    input: SearchPostingsInput,
  ): Array<Record<string, unknown>> {
    switch (input.sort) {
      case "dailyPrice":
        return [
          {
            dailyPriceAmount: {
              order: "asc",
            },
          },
          ...this.buildStableRecencySort("desc"),
        ];
      case "oldest":
        return this.buildStableRecencySort("asc");
      case "nameAsc":
        return [
          {
            "name.sort": {
              order: "asc",
            },
          },
          ...this.buildStableRecencySort("desc"),
        ];
      case "nameDesc":
        return [
          {
            "name.sort": {
              order: "desc",
            },
          },
          ...this.buildStableRecencySort("desc"),
        ];
      case "nearest":
        if (input.geo) {
          return [
            {
              _geo_distance: {
                geoPoint: {
                  lat: input.geo.latitude,
                  lon: input.geo.longitude,
                },
                order: "asc",
                unit: "km",
              },
            },
            ...this.buildStableRecencySort("desc"),
          ];
        }

        return this.buildStableRecencySort("desc");
      case "newest":
        return this.buildStableRecencySort("desc");
      case "relevance":
      default:
        return input.query
          ? [
              {
                _score: {
                  order: "desc",
                },
              },
              ...this.buildStableRecencySort("desc"),
            ]
          : this.buildStableRecencySort("desc");
    }
  }

  private buildStableRecencySort(
    direction: "asc" | "desc",
  ): Array<Record<string, unknown>> {
    return [
      {
        publishedAt: {
          order: direction,
        },
      },
      {
        createdAt: {
          order: direction,
        },
      },
      {
        id: {
          order: "asc",
        },
      },
    ];
  }

  private createPagination(page: number, pageSize: number, total: number) {
    const navigableTotal = Math.min(total, MAX_SEARCH_RESULT_WINDOW);
    const totalPages = Math.max(1, Math.ceil(navigableTotal / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  private async searchIdsFromDatabase(
    input: SearchPostingsInput,
    reason: SearchFallbackReason,
  ): Promise<SearchIdsResult> {
    recordSearchFallback(reason);
    const fallback = await this.postingsRepository.searchPublicFallback(input);

    return {
      ...fallback,
      source: "database",
      fallbackReason: reason,
    };
  }

  private async hydratePublicPostings(
    ids: string[],
  ): Promise<BatchPostingsResult<PublicPostingRecord>> {
    const cachedBatch =
      await this.postingsPublicCacheService.getPublicByIds(ids);

    if (cachedBatch.missingIds.length === 0) {
      return cachedBatch;
    }

    const repositoryBatch = await this.postingsRepository.batchFindPublic({
      ids: cachedBatch.missingIds,
    });
    const byId = new Map<string, PublicPostingRecord>();

    for (const posting of cachedBatch.postings) {
      byId.set(posting.id, posting);
    }

    for (const posting of repositoryBatch.postings) {
      byId.set(posting.id, posting);
    }

    const postings: PublicPostingRecord[] = [];
    const missingIds: string[] = [];

    for (const id of ids) {
      const posting = byId.get(id);

      if (!posting) {
        missingIds.push(id);
        continue;
      }

      postings.push(posting);
    }

    return {
      postings,
      missingIds,
    };
  }

  private buildAttributeFilters(
    filter: SearchAttributeFilterInput,
  ): Array<Record<string, unknown>> {
    const field = `searchableAttributes.${filter.key}`;
    const clauses: Array<Record<string, unknown>> = [];

    if (
      typeof filter.value === "string" ||
      typeof filter.value === "number" ||
      typeof filter.value === "boolean"
    ) {
      clauses.push({
        term: {
          [field]: filter.value,
        },
      });
    } else if (Array.isArray(filter.value)) {
      clauses.push({
        bool: {
          filter: filter.value.map((value) => ({
            term: {
              [field]: value,
            },
          })),
        },
      });
    }

    if (filter.min !== undefined || filter.max !== undefined) {
      clauses.push({
        range: {
          [field]: {
            ...(filter.min !== undefined ? { gte: filter.min } : {}),
            ...(filter.max !== undefined ? { lte: filter.max } : {}),
          },
        },
      });
    }

    return clauses;
  }
}
