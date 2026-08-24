import {
  ElasticsearchCircuitOpenError,
  getElasticsearchClient,
  type ElasticsearchClient,
} from "@/configuration/resources/elasticsearch";
import type { OrganizationSearchSource } from "@/features/organizations/organizations.model";
import type {
  ListPublicOrganizationsInput,
  PublicOrganizationListResult,
} from "@/features/organizations/profile/profile.model";
import type { OrganizationsPublicSearchRepository } from "@/features/organizations/search/public-search.repository";
import type { OrganizationsSearchIndexService } from "@/features/organizations/search/index.service";
import type { SearchFallbackReason } from "@/features/search/search.model";
import { recordSearchFallback } from "@/features/search/search.telemetry";
import { loggerFactory, type Logger } from "@/configuration/logging";

// Elasticsearch caps deep pagination; keep the navigable window bounded so the
// UI never requests an offset beyond what the cluster will serve.
const MAX_SEARCH_RESULT_WINDOW = 10_000;

interface SearchIdsResult {
  ids: string[];
  total: number;
  source: OrganizationSearchSource;
  fallbackReason?: SearchFallbackReason;
}

interface ElasticsearchSearchResponse {
  hits?: {
    total?: {
      value?: number;
    };
    hits?: Array<{
      _id: string;
      _score?: number;
    }>;
  };
}

type SearchQueryMode = "strict" | "tolerant";

// Read path for the public organization directory. Prefers Elasticsearch for
// multi-field, typo-tolerant relevance and transparently falls back to the
// database when the search cluster is unavailable. Elasticsearch only returns
// ordered ids + a total; the repository hydrates the display rows (including a
// live published-posting count).
export class OrganizationsPublicSearchService {
  private readonly logger: Logger;

  constructor(
    private readonly organizationsPublicSearchRepository: OrganizationsPublicSearchRepository,
    private readonly organizationsSearchIndexService: OrganizationsSearchIndexService,
    private readonly elasticsearch: ElasticsearchClient = getElasticsearchClient(),
  ) {
    this.logger = loggerFactory.forClass(
      OrganizationsPublicSearchService,
      "service",
    );
  }

  async searchPublic(
    input: ListPublicOrganizationsInput,
  ): Promise<PublicOrganizationListResult> {
    let searchIds = await this.searchIdsWithFallback(input);
    let organizations = await this.organizationsPublicSearchRepository.batchFindPublicByIds(
      searchIds.ids,
    );

    if (
      searchIds.source === "elasticsearch" &&
      organizations.length < searchIds.ids.length
    ) {
      this.logger.warn(
        "Organization search falling back to database because Elasticsearch returned stale ids.",
      );
      searchIds = await this.searchIdsFromDatabase(input, "index-drift");
      organizations = await this.organizationsPublicSearchRepository.batchFindPublicByIds(
        searchIds.ids,
      );
    }

    return {
      organizations,
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
    input: ListPublicOrganizationsInput,
  ): Promise<SearchIdsResult> {
    if (this.elasticsearch.isEnabled()) {
      try {
        return await this.searchIdsInElasticsearch(input);
      } catch (error) {
        if (error instanceof ElasticsearchCircuitOpenError) {
          this.logger.info(
            "Organization search using database fallback because Elasticsearch circuit is open.",
          );
          return this.searchIdsFromDatabase(input, "circuit-open");
        }

        this.logger.warn(
          "Organization search falling back to database.",
          undefined,
          error,
        );
        return this.searchIdsFromDatabase(input, "es-unavailable");
      }
    }

    return this.searchIdsFromDatabase(input, "es-unavailable");
  }

  private async searchIdsInElasticsearch(
    input: ListPublicOrganizationsInput,
  ): Promise<SearchIdsResult> {
    const indexName = this.organizationsSearchIndexService.getReadAliasName();
    const from = (input.page - 1) * input.pageSize;
    let response =
      await this.elasticsearch.requestJson<ElasticsearchSearchResponse>(
        `/${encodeURIComponent(indexName)}/_search`,
        {
          method: "POST",
          body: JSON.stringify(this.buildSearchRequest(input, from, "strict")),
        },
      );
    let hits = response.hits?.hits ?? [];
    let total = response.hits?.total?.value ?? 0;

    if (input.query && total === 0) {
      this.logger.info(
        "Organization search retrying with tolerant Elasticsearch typo matching.",
        {
          query: input.query,
        },
      );
      response =
        await this.elasticsearch.requestJson<ElasticsearchSearchResponse>(
          `/${encodeURIComponent(indexName)}/_search`,
          {
            method: "POST",
            body: JSON.stringify(
              this.buildSearchRequest(input, from, "tolerant"),
            ),
          },
        );
      hits = response.hits?.hits ?? [];
      total = response.hits?.total?.value ?? 0;
    }

    return {
      ids: hits.map((hit) => hit._id),
      total,
      source: "elasticsearch",
    };
  }

  private buildSearchRequest(
    input: ListPublicOrganizationsInput,
    from: number,
    mode: SearchQueryMode,
  ): Record<string, unknown> {
    const must: Array<Record<string, unknown>> = [];

    if (input.query) {
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
                  "location.city^3",
                  "location.region^2",
                  "location.country^2",
                  "description",
                ],
                fuzziness: "AUTO",
                prefix_length: mode === "strict" ? 1 : 0,
                ...(mode === "tolerant" ? { max_expansions: 25 } : {}),
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
                boost: 0.8,
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    return {
      from,
      size: input.pageSize,
      _source: false,
      query: {
        bool: {
          ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
        },
      },
      sort: this.buildSort(input),
      track_total_hits: true,
    };
  }

  private buildSort(
    input: ListPublicOrganizationsInput,
  ): Array<Record<string, unknown>> {
    switch (input.sort) {
      case "oldest":
        return this.buildStableRecencySort("asc");
      case "newest":
        return this.buildStableRecencySort("desc");
      case "nameAsc":
        return [
          { "name.sort": { order: "asc" } },
          ...this.buildStableRecencySort("desc"),
        ];
      case "nameDesc":
        return [
          { "name.sort": { order: "desc" } },
          ...this.buildStableRecencySort("desc"),
        ];
      case "relevance":
      default:
        return input.query
          ? [
              { _score: { order: "desc" } },
              { "name.sort": { order: "asc" } },
              ...this.buildStableRecencySort("desc"),
            ]
          : [
              { "name.sort": { order: "asc" } },
              ...this.buildStableRecencySort("desc"),
            ];
    }
  }

  private buildStableRecencySort(
    direction: "asc" | "desc",
  ): Array<Record<string, unknown>> {
    return [{ createdAt: { order: direction } }, { id: { order: "asc" } }];
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
    input: ListPublicOrganizationsInput,
    reason: SearchFallbackReason,
  ): Promise<SearchIdsResult> {
    recordSearchFallback(reason);
    const fallback =
      await this.organizationsPublicSearchRepository.searchPublicFallback(input);

    return {
      ...fallback,
      source: "database",
      fallbackReason: reason,
    };
  }
}
