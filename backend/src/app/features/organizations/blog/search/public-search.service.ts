import {
  ElasticsearchCircuitOpenError,
  getElasticsearchClient,
  type ElasticsearchClient,
} from "@/configuration/resources/elasticsearch";
import type {
  ListOrganizationBlogPostsResult,
  ListPublicBlogFeedInput,
  ListPublicOrganizationBlogPostsInput,
  OrganizationBlogPagination,
  OrganizationBlogSearchSource,
  OrganizationBlogSort,
} from "@/features/organizations/blog/blog.model";
import type {
  OrganizationBlogRepository,
  OrganizationBlogSearchFallbackInput,
} from "@/features/organizations/blog/blog.repository";
import type { OrganizationBlogSearchIndexService } from "@/features/organizations/blog/search/index.service";
import type { SearchFallbackReason } from "@/features/search/search.model";
import { recordSearchFallback } from "@/features/search/search.telemetry";
import { loggerFactory, type Logger } from "@/configuration/logging";

// Elasticsearch caps deep pagination; keep the navigable window bounded so the
// UI never requests an offset beyond what the cluster will serve.
const MAX_SEARCH_RESULT_WINDOW = 10_000;

// Normalized parameters shared by the global feed and the per-organization feed.
interface BlogSearchParams {
  page: number;
  pageSize: number;
  query?: string;
  tag?: string;
  sort?: OrganizationBlogSort;
  organizationId?: string;
}

interface SearchIdsResult {
  ids: string[];
  total: number;
  source: OrganizationBlogSearchSource;
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

// Read path for the public organization blog feeds — both the global,
// cross-organization feed and the per-organization feed. Prefers Elasticsearch
// for multi-field, typo-tolerant relevance over published posts and transparently
// falls back to the database when the search cluster is unavailable.
// Elasticsearch only returns ordered ids + a total; the repository hydrates the
// display rows (author + organization summary).
export class OrganizationBlogPublicSearchService {
  private readonly logger: Logger;

  constructor(
    private readonly organizationBlogRepository: OrganizationBlogRepository,
    private readonly organizationBlogSearchIndexService: OrganizationBlogSearchIndexService,
    private readonly elasticsearch: ElasticsearchClient = getElasticsearchClient(),
  ) {
    this.logger = loggerFactory.forClass(
      OrganizationBlogPublicSearchService,
      "service",
    );
  }

  async searchGlobal(
    input: ListPublicBlogFeedInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    return this.search({
      page: input.page,
      pageSize: input.pageSize,
      query: input.q,
      tag: input.tag,
      sort: input.sort,
    });
  }

  async searchByOrganization(
    input: ListPublicOrganizationBlogPostsInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    return this.search({
      page: input.page,
      pageSize: input.pageSize,
      query: input.q,
      tag: input.tag,
      sort: input.sort,
      organizationId: input.organizationId,
    });
  }

  private async search(
    params: BlogSearchParams,
  ): Promise<ListOrganizationBlogPostsResult> {
    let searchIds = await this.searchIdsWithFallback(params);
    let posts = await this.organizationBlogRepository.batchFindPublishedByIds(
      searchIds.ids,
    );

    if (
      searchIds.source === "elasticsearch" &&
      posts.length < searchIds.ids.length
    ) {
      this.logger.warn(
        "Organization blog search falling back to database because Elasticsearch returned stale ids.",
      );
      searchIds = await this.searchIdsFromDatabase(params, "index-drift");
      posts = await this.organizationBlogRepository.batchFindPublishedByIds(
        searchIds.ids,
      );
    }

    return {
      posts,
      pagination: this.createPagination(
        params.page,
        params.pageSize,
        searchIds.total,
      ),
      source: searchIds.source,
      ...(params.query ? { query: params.query } : {}),
    };
  }

  private async searchIdsWithFallback(
    params: BlogSearchParams,
  ): Promise<SearchIdsResult> {
    if (this.elasticsearch.isEnabled()) {
      try {
        return await this.searchIdsInElasticsearch(params);
      } catch (error) {
        if (error instanceof ElasticsearchCircuitOpenError) {
          this.logger.info(
            "Organization blog search using database fallback because Elasticsearch circuit is open.",
          );
          return this.searchIdsFromDatabase(params, "circuit-open");
        }

        this.logger.warn(
          "Organization blog search falling back to database.",
          undefined,
          error,
        );
        return this.searchIdsFromDatabase(params, "es-unavailable");
      }
    }

    return this.searchIdsFromDatabase(params, "es-unavailable");
  }

  private async searchIdsInElasticsearch(
    params: BlogSearchParams,
  ): Promise<SearchIdsResult> {
    const indexName =
      this.organizationBlogSearchIndexService.getReadAliasName();
    // Elasticsearch rejects `from + size` beyond index.max_result_window with a
    // 400. Clamp both into the navigable window so an out-of-range page returns
    // an empty page with the true total (size 0 still reports total_hits) rather
    // than a 400 that would be misread as an ES outage and record a false
    // database fallback.
    const from = Math.min(
      (params.page - 1) * params.pageSize,
      MAX_SEARCH_RESULT_WINDOW,
    );
    const size = Math.max(
      0,
      Math.min(params.pageSize, MAX_SEARCH_RESULT_WINDOW - from),
    );
    let response =
      await this.elasticsearch.requestJson<ElasticsearchSearchResponse>(
        `/${encodeURIComponent(indexName)}/_search`,
        {
          method: "POST",
          body: JSON.stringify(
            this.buildSearchRequest(params, from, size, "strict"),
          ),
        },
      );
    let hits = response.hits?.hits ?? [];
    let total = response.hits?.total?.value ?? 0;

    if (params.query && total === 0) {
      this.logger.info(
        "Organization blog search retrying with tolerant Elasticsearch typo matching.",
        {
          query: params.query,
        },
      );
      response =
        await this.elasticsearch.requestJson<ElasticsearchSearchResponse>(
          `/${encodeURIComponent(indexName)}/_search`,
          {
            method: "POST",
            body: JSON.stringify(
              this.buildSearchRequest(params, from, size, "tolerant"),
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
    params: BlogSearchParams,
    from: number,
    size: number,
    mode: SearchQueryMode,
  ): Record<string, unknown> {
    const filter: Array<Record<string, unknown>> = [
      { term: { status: "published" } },
    ];

    if (params.organizationId) {
      filter.push({ term: { organizationId: params.organizationId } });
    }

    if (params.tag) {
      filter.push({ term: { "tags.keyword": params.tag.toLowerCase() } });
    }

    const must: Array<Record<string, unknown>> = [];

    if (params.query) {
      must.push({
        bool: {
          should: [
            {
              match_phrase: {
                title: {
                  query: params.query,
                  boost: 10,
                },
              },
            },
            {
              multi_match: {
                query: params.query,
                type: "cross_fields",
                operator: "and",
                fields: ["title^7", "excerpt^3", "tags^3", "body^1"],
              },
            },
            {
              multi_match: {
                query: params.query,
                fields: ["title^5", "excerpt^2", "tags^2", "body^1"],
                fuzziness: "AUTO",
                prefix_length: mode === "strict" ? 1 : 0,
                ...(mode === "tolerant" ? { max_expansions: 25 } : {}),
                boost: 0.7,
              },
            },
            {
              multi_match: {
                query: params.query,
                type: "bool_prefix",
                fields: ["title.prefix^4"],
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
      size,
      _source: false,
      query: {
        bool: {
          filter,
          ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
        },
      },
      sort: this.buildSort(params),
      track_total_hits: true,
    };
  }

  private buildSort(params: BlogSearchParams): Array<Record<string, unknown>> {
    switch (params.sort) {
      case "oldest":
        return this.buildStableRecencySort("asc");
      case "newest":
        return this.buildStableRecencySort("desc");
      case "relevance":
      default:
        return params.query
          ? [
              { _score: { order: "desc" } },
              ...this.buildStableRecencySort("desc"),
            ]
          : this.buildStableRecencySort("desc");
    }
  }

  private buildStableRecencySort(
    direction: "asc" | "desc",
  ): Array<Record<string, unknown>> {
    return [
      { publishedAt: { order: direction } },
      { createdAt: { order: direction } },
      { id: { order: "asc" } },
    ];
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): OrganizationBlogPagination {
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
    params: BlogSearchParams,
    reason: SearchFallbackReason,
  ): Promise<SearchIdsResult> {
    recordSearchFallback(reason);
    const fallbackInput: OrganizationBlogSearchFallbackInput = {
      page: params.page,
      pageSize: params.pageSize,
      query: params.query,
      tag: params.tag,
      sort: params.sort,
      organizationId: params.organizationId,
    };
    const fallback =
      await this.organizationBlogRepository.searchPublicFallback(fallbackInput);

    return {
      ...fallback,
      source: "database",
      fallbackReason: reason,
    };
  }
}
