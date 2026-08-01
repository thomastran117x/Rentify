import {
  ElasticsearchRequestError,
  ElasticsearchUnavailableError,
  getElasticsearchClient,
  type ElasticsearchCircuitBreakerState,
  type ElasticsearchClient,
} from "@/configuration/resources/elasticsearch";
import type { PostingSearchDocument } from "@/features/postings/postings.model";
import { postingVariantCatalog } from "@/features/postings/postings.variants";
import type { SearchAliasStatus } from "@/features/search/search.model";
import { recordAliasAction } from "@/features/search/search.telemetry";
import { loggerFactory, type Logger } from "@/configuration/logging";

interface ElasticsearchBulkResponseItem {
  index?: {
    status: number;
    error?: {
      reason?: string;
      type?: string;
    };
  };
  delete?: {
    status: number;
    result?: string;
    error?: {
      reason?: string;
      type?: string;
    };
  };
}

interface ElasticsearchBulkResponse {
  errors?: boolean;
  items?: ElasticsearchBulkResponseItem[];
}

type ElasticsearchAliasResponse = Record<string, unknown>;

type ElasticsearchMappingResponse = Record<
  string,
  {
    mappings?: {
      _meta?: {
        mappingVersion?: number;
      };
    };
  }
>;

/**
 * Bump whenever `buildIndexConfiguration()` changes in a way that existing
 * documents cannot satisfy without being re-indexed.
 *
 * Mappings are `dynamic: false`, so an index created under an older version
 * silently discards any field added later. Stamping the version into the index
 * `_meta` lets the search maintainer detect that drift and rebuild, instead of
 * quietly serving queries that can never match.
 *
 * 2: added `organizationName` (organization-name matching and sorting).
 */
export const POSTINGS_INDEX_MAPPING_VERSION = 2;

class ElasticsearchAliasStateError extends ElasticsearchUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "ElasticsearchAliasStateError";
  }
}

export class PostingsSearchIndexService {
  private readonly logger: Logger;

  constructor(
    private readonly elasticsearch: ElasticsearchClient = getElasticsearchClient(),
  ) {
    this.logger = loggerFactory.forClass(PostingsSearchIndexService, "service");
  }

  async ensureLiveIndex(): Promise<void> {
    if (!this.isElasticsearchEnabled()) {
      return;
    }

    const aliasStatus = await this.getAliasStatus();

    switch (aliasStatus.state) {
      case "disabled":
      case "ready":
        return;
      case "missing": {
        const indexName = this.createVersionedIndexName();
        await this.createConcreteIndex(indexName);
        await this.setAliases(indexName, [], []);
        recordAliasAction("created_index");
        return;
      }
      case "missing_read_alias":
        await this.addAlias(
          aliasStatus.writeTargets[0]!,
          this.getReadAliasName(),
        );
        recordAliasAction("repaired_read_alias");
        return;
      case "missing_write_alias":
        await this.addAlias(
          aliasStatus.readTargets[0]!,
          this.getWriteAliasName(),
          true,
        );
        recordAliasAction("repaired_write_alias");
        return;
      case "inconsistent":
      default:
        throw new ElasticsearchAliasStateError(
          aliasStatus.message ??
            "Elasticsearch aliases are inconsistent and cannot be repaired automatically.",
        );
    }
  }

  async createVersionedIndex(
    indexName = this.createVersionedIndexName(),
  ): Promise<string> {
    try {
      await this.createConcreteIndex(indexName);
    } catch (error) {
      if (!this.isIndexAlreadyExistsError(error)) {
        throw error;
      }
    }
    return indexName;
  }

  buildVersionedIndexName(): string {
    return this.createVersionedIndexName();
  }

  async deleteConcreteIndex(indexName: string): Promise<void> {
    await this.elasticsearch.requestJson(
      `/${encodeURIComponent(indexName)}`,
      {
        method: "DELETE",
      },
      {
        allowNotFound: true,
      },
    );
  }

  async upsertDocument(
    document: PostingSearchDocument,
    targetIndexName?: string,
  ): Promise<void> {
    const indexName = await this.resolveWriteTarget(targetIndexName);

    await this.elasticsearch.requestJson(
      `/${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(document.id)}`,
      {
        method: "PUT",
        body: JSON.stringify(this.toElasticsearchDocument(document)),
      },
    );
  }

  async bulkUpsertDocuments(
    documents: PostingSearchDocument[],
    targetIndexName: string,
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const payload = documents
      .flatMap((document) => [
        JSON.stringify({
          index: {
            _index: targetIndexName,
            _id: document.id,
          },
        }),
        JSON.stringify(this.toElasticsearchDocument(document)),
      ])
      .join("\n")
      .concat("\n");

    const response =
      await this.elasticsearch.requestJson<ElasticsearchBulkResponse>(
        "/_bulk",
        {
          method: "POST",
          body: payload,
        },
        {
          contentType: "application/x-ndjson",
        },
      );

    this.throwOnBulkErrors(response, "index");
  }

  async bulkDeleteDocuments(
    ids: string[],
    targetIndexName: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const payload = ids
      .map((id) =>
        JSON.stringify({
          delete: {
            _index: targetIndexName,
            _id: id,
          },
        }),
      )
      .join("\n")
      .concat("\n");

    const response =
      await this.elasticsearch.requestJson<ElasticsearchBulkResponse>(
        "/_bulk",
        {
          method: "POST",
          body: payload,
        },
        {
          contentType: "application/x-ndjson",
        },
      );

    this.throwOnBulkErrors(response, "delete");
  }

  async deleteDocument(id: string, targetIndexName?: string): Promise<void> {
    const indexName = await this.resolveWriteTarget(targetIndexName);

    await this.elasticsearch.requestJson(
      `/${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
      {
        allowNotFound: true,
      },
    );
  }

  async getAliasTargets(aliasName: string): Promise<string[]> {
    const response =
      await this.elasticsearch.requestJson<ElasticsearchAliasResponse>(
        `/_alias/${encodeURIComponent(aliasName)}`,
        {
          method: "GET",
        },
        {
          allowNotFound: true,
        },
      );

    return Object.keys(response);
  }

  async getAliasStatus(): Promise<SearchAliasStatus> {
    const readAlias = this.getReadAliasName();
    const writeAlias = this.getWriteAliasName();

    if (!this.isElasticsearchEnabled()) {
      return {
        state: "disabled",
        readAlias,
        writeAlias,
        readTargets: [],
        writeTargets: [],
      };
    }

    const [readTargets, writeTargets] = await Promise.all([
      this.getAliasTargets(readAlias),
      this.getAliasTargets(writeAlias),
    ]);

    if (readTargets.length === 0 && writeTargets.length === 0) {
      return {
        state: "missing",
        readAlias,
        writeAlias,
        readTargets,
        writeTargets,
      };
    }

    if (
      readTargets.length === 1 &&
      writeTargets.length === 1 &&
      readTargets[0] === writeTargets[0]
    ) {
      return {
        state: "ready",
        readAlias,
        writeAlias,
        readTargets,
        writeTargets,
      };
    }

    if (readTargets.length === 0 && writeTargets.length === 1) {
      return {
        state: "missing_read_alias",
        readAlias,
        writeAlias,
        readTargets,
        writeTargets,
      };
    }

    if (readTargets.length === 1 && writeTargets.length === 0) {
      return {
        state: "missing_write_alias",
        readAlias,
        writeAlias,
        readTargets,
        writeTargets,
      };
    }

    return {
      state: "inconsistent",
      readAlias,
      writeAlias,
      readTargets,
      writeTargets,
      message:
        "Read and write aliases do not resolve to a single shared concrete index and require manual repair.",
    };
  }

  async swapAliases(newIndexName: string): Promise<{
    previousReadTargets: string[];
    previousWriteTargets: string[];
  }> {
    const [previousReadTargets, previousWriteTargets] = await Promise.all([
      this.getAliasTargets(this.getReadAliasName()),
      this.getAliasTargets(this.getWriteAliasName()),
    ]);

    await this.setAliases(
      newIndexName,
      previousReadTargets,
      previousWriteTargets,
    );

    return {
      previousReadTargets,
      previousWriteTargets,
    };
  }

  isElasticsearchEnabled(): boolean {
    return this.elasticsearch.isEnabled();
  }

  /**
   * Mapping version stamped on the index currently serving reads, or null when
   * Elasticsearch is disabled, no index is live, or the index predates version
   * stamping (which is itself stale).
   */
  async readLiveMappingVersion(): Promise<number | null> {
    if (!this.isElasticsearchEnabled()) {
      return null;
    }

    const response =
      await this.elasticsearch.requestJson<ElasticsearchMappingResponse>(
        `/${encodeURIComponent(this.getReadAliasName())}/_mapping`,
        {
          method: "GET",
        },
        {
          allowNotFound: true,
        },
      );

    const versions = Object.values(response)
      .map((index) => index?.mappings?._meta?.mappingVersion)
      .filter((version): version is number => typeof version === "number");

    if (versions.length === 0) {
      return null;
    }

    // The oldest target decides: any index behind the current version is
    // serving documents that are missing newly mapped fields.
    return Math.min(...versions);
  }

  /**
   * Whether the live index was built from an older mapping and therefore needs
   * rebuilding before newly mapped fields can be queried.
   */
  async isLiveMappingStale(): Promise<boolean> {
    if (!this.isElasticsearchEnabled()) {
      return false;
    }

    const aliasStatus = await this.getAliasStatus();

    // Only a healthy, live index can be stale; every other state is either
    // repaired or created from the current mapping by ensureLiveIndex().
    if (aliasStatus.state !== "ready") {
      return false;
    }

    const liveVersion = await this.readLiveMappingVersion();

    return liveVersion === null || liveVersion < POSTINGS_INDEX_MAPPING_VERSION;
  }

  getCircuitBreakerState(): ElasticsearchCircuitBreakerState {
    return this.elasticsearch.getCircuitBreakerState();
  }

  getBaseIndexName(): string {
    return this.elasticsearch.getPostingsIndexName();
  }

  getReadAliasName(): string {
    return `${this.getBaseIndexName()}-read`;
  }

  getWriteAliasName(): string {
    return `${this.getBaseIndexName()}-write`;
  }

  private toElasticsearchDocument(
    document: PostingSearchDocument,
  ): Record<string, unknown> {
    const primaryPhoto =
      document.photos.find((photo) => photo.position === 0) ??
      document.photos[0];

    return {
      id: document.id,
      organizationId: document.organizationId,
      // Conditional: an empty keyword would sort ahead of every real name and
      // pollute the head of the organization sort.
      ...(document.organizationName
        ? { organizationName: document.organizationName }
        : {}),
      status: document.status,
      family: document.variant.family,
      subtype: document.variant.subtype,
      name: document.name,
      description: document.description,
      tags: document.tags,
      availabilityStatus: document.availabilityStatus,
      searchableAttributes: document.searchableAttributes,
      pricing: document.pricing,
      pricingCurrency: document.pricingCurrency,
      dailyPriceAmount: document.pricing.daily.amount,
      geoPoint: {
        lat: document.location.latitude,
        lon: document.location.longitude,
      },
      location: {
        city: document.location.city,
        region: document.location.region,
        country: document.location.country,
        postalCode: document.location.postalCode,
      },
      primaryPhotoUrl: primaryPhoto?.blobUrl,
      photoUrls: document.photos.map((photo) => photo.blobUrl),
      blockedRanges: document.blockedRanges,
      minBookingDurationDays: document.minBookingDurationDays,
      advanceNoticeDays: document.advanceNoticeDays,
      cancellationPolicy: document.cancellationPolicy,
      instantBooking: document.instantBooking,
      averageRating: document.averageRating,
      reviewCount: document.reviewCount,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      publishedAt: document.publishedAt,
    };
  }

  private async resolveWriteTarget(targetIndexName?: string): Promise<string> {
    if (targetIndexName) {
      return targetIndexName;
    }

    await this.ensureLiveIndex();
    return this.getWriteAliasName();
  }

  private createVersionedIndexName(): string {
    return `${this.getBaseIndexName()}_v${Date.now()}`;
  }

  private async createConcreteIndex(indexName: string): Promise<void> {
    await this.elasticsearch.requestJson(`/${encodeURIComponent(indexName)}`, {
      method: "PUT",
      body: JSON.stringify(this.buildIndexConfiguration()),
    });
  }

  private isIndexAlreadyExistsError(error: unknown): boolean {
    return (
      error instanceof ElasticsearchRequestError &&
      error.status === 400 &&
      error.message.toLowerCase().includes("resource_already_exists_exception")
    );
  }

  private async setAliases(
    newIndexName: string,
    previousReadTargets: string[],
    previousWriteTargets: string[],
  ): Promise<void> {
    const actions: Array<Record<string, unknown>> = [
      ...previousReadTargets.map((index) => ({
        remove: {
          index,
          alias: this.getReadAliasName(),
        },
      })),
      ...previousWriteTargets.map((index) => ({
        remove: {
          index,
          alias: this.getWriteAliasName(),
        },
      })),
      {
        add: {
          index: newIndexName,
          alias: this.getReadAliasName(),
        },
      },
      {
        add: {
          index: newIndexName,
          alias: this.getWriteAliasName(),
          is_write_index: true,
        },
      },
    ];

    await this.elasticsearch.requestJson("/_aliases", {
      method: "POST",
      body: JSON.stringify({
        actions,
      }),
    });
  }

  private async addAlias(
    indexName: string,
    aliasName: string,
    isWriteIndex = false,
  ): Promise<void> {
    await this.elasticsearch.requestJson("/_aliases", {
      method: "POST",
      body: JSON.stringify({
        actions: [
          {
            add: {
              index: indexName,
              alias: aliasName,
              ...(isWriteIndex ? { is_write_index: true } : {}),
            },
          },
        ],
      }),
    });
  }

  private buildIndexConfiguration(): Record<string, unknown> {
    return {
      settings: {
        analysis: {
          filter: {
            autocomplete_filter: {
              type: "edge_ngram",
              min_gram: 2,
              max_gram: 20,
            },
          },
          analyzer: {
            search_text: {
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding"],
            },
            autocomplete_index: {
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding", "autocomplete_filter"],
            },
            autocomplete_search: {
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding"],
            },
          },
          normalizer: {
            lowercase_normalizer: {
              type: "custom",
              filter: ["lowercase", "asciifolding"],
            },
          },
        },
      },
      mappings: {
        dynamic: false,
        _meta: {
          mappingVersion: POSTINGS_INDEX_MAPPING_VERSION,
        },
        properties: {
          id: { type: "keyword" },
          organizationId: { type: "keyword" },
          organizationName: {
            type: "text",
            analyzer: "search_text",
            fields: {
              sort: {
                type: "keyword",
                normalizer: "lowercase_normalizer",
              },
              prefix: {
                type: "text",
                analyzer: "autocomplete_index",
                search_analyzer: "autocomplete_search",
              },
            },
          },
          status: { type: "keyword" },
          family: { type: "keyword" },
          subtype: { type: "keyword" },
          name: {
            type: "text",
            analyzer: "search_text",
            fields: {
              sort: {
                type: "keyword",
                normalizer: "lowercase_normalizer",
              },
              prefix: {
                type: "text",
                analyzer: "autocomplete_index",
                search_analyzer: "autocomplete_search",
              },
            },
          },
          description: {
            type: "text",
            analyzer: "search_text",
          },
          tags: {
            type: "keyword",
            normalizer: "lowercase_normalizer",
            fields: {
              text: {
                type: "text",
                analyzer: "search_text",
              },
              prefix: {
                type: "text",
                analyzer: "autocomplete_index",
                search_analyzer: "autocomplete_search",
              },
            },
          },
          availabilityStatus: { type: "keyword" },
          pricingCurrency: { type: "keyword" },
          dailyPriceAmount: { type: "double" },
          cancellationPolicy: { type: "keyword" },
          instantBooking: { type: "boolean" },
          minBookingDurationDays: { type: "integer" },
          advanceNoticeDays: { type: "integer" },
          averageRating: { type: "float" },
          reviewCount: { type: "integer" },
          geoPoint: { type: "geo_point" },
          primaryPhotoUrl: { type: "keyword", index: false },
          photoUrls: { type: "keyword", index: false },
          createdAt: { type: "date" },
          updatedAt: { type: "date" },
          publishedAt: { type: "date" },
          location: {
            properties: {
              city: {
                type: "text",
                analyzer: "search_text",
                fields: {
                  prefix: {
                    type: "text",
                    analyzer: "autocomplete_index",
                    search_analyzer: "autocomplete_search",
                  },
                },
              },
              region: {
                type: "text",
                analyzer: "search_text",
                fields: {
                  prefix: {
                    type: "text",
                    analyzer: "autocomplete_index",
                    search_analyzer: "autocomplete_search",
                  },
                },
              },
              country: {
                type: "text",
                analyzer: "search_text",
                fields: {
                  prefix: {
                    type: "text",
                    analyzer: "autocomplete_index",
                    search_analyzer: "autocomplete_search",
                  },
                },
              },
              postalCode: { type: "keyword" },
            },
          },
          blockedRanges: {
            type: "nested",
            properties: {
              startAt: { type: "date" },
              endAt: { type: "date" },
              source: { type: "keyword" },
            },
          },
          searchableAttributes: {
            properties: this.buildSearchableAttributeMappings(),
          },
        },
      },
    };
  }

  private buildSearchableAttributeMappings(): Record<string, unknown> {
    const mappings: Record<string, unknown> = {};

    for (const family of Object.values(postingVariantCatalog)) {
      for (const [attributeKey, definition] of Object.entries(
        family.searchableAttributes,
      )) {
        if (mappings[attributeKey]) {
          continue;
        }

        mappings[attributeKey] = this.toSearchableAttributeMapping(
          definition.kind,
        );
      }
    }

    return mappings;
  }

  private toSearchableAttributeMapping(
    kind: "string" | "number" | "integer" | "boolean" | "stringArray",
  ) {
    switch (kind) {
      case "boolean":
        return { type: "boolean" };
      case "integer":
        return { type: "integer" };
      case "number":
        return { type: "double" };
      case "stringArray":
      case "string":
      default:
        return { type: "keyword", normalizer: "lowercase_normalizer" };
    }
  }

  private throwOnBulkErrors(
    response: ElasticsearchBulkResponse,
    operation: "index" | "delete",
  ): void {
    if (!response.errors) {
      return;
    }

    const firstFailure = response.items?.find((item) => {
      const result = operation === "index" ? item.index : item.delete;

      if (!result?.error) {
        return false;
      }

      return !(operation === "delete" && result.status === 404);
    });
    const firstError =
      operation === "index" ? firstFailure?.index : firstFailure?.delete;

    if (!firstError?.error) {
      return;
    }

    const message =
      `Bulk ${operation} failed with status ${firstError.status}: ${firstError.error.type ?? "unknown"} ${firstError.error.reason ?? ""}`.trim();

    if (firstError.status >= 500) {
      throw new ElasticsearchUnavailableError(message);
    }

    throw new ElasticsearchRequestError(firstError.status, message);
  }
}
