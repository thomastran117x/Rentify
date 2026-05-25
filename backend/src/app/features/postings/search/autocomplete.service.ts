import {
  ElasticsearchCircuitOpenError,
  getElasticsearchClient,
  type ElasticsearchClient,
} from "@/configuration/resources/elasticsearch";
import { loggerFactory, type Logger } from "@/configuration/logging";
import type {
  PostingAutocompleteInput,
  PostingAutocompleteResult,
  PostingAutocompleteSuggestion,
  PostingAutocompleteSuggestionKind,
} from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";

interface ElasticsearchAutocompleteHit {
  _id: string;
  _score?: number;
  _source?: {
    name?: string;
    tags?: string[];
    location?: {
      city?: string;
      region?: string;
      country?: string;
    };
    publishedAt?: string;
    createdAt?: string;
  };
}

interface ElasticsearchAutocompleteResponse {
  hits?: {
    hits?: ElasticsearchAutocompleteHit[];
  };
}

interface AutocompleteCandidateDocument {
  name?: string;
  tags: string[];
  location: {
    city?: string;
    region?: string;
    country?: string;
  };
  publishedAt?: string;
  createdAt?: string;
}

interface RankedSuggestion extends PostingAutocompleteSuggestion {
  kindPriority: number;
  documentRank: number;
  publishedAtMs: number;
}

const AUTOCOMPLETE_CANDIDATE_LIMIT_MULTIPLIER = 5;
const AUTOCOMPLETE_MIN_CANDIDATES = 12;
const AUTOCOMPLETE_MAX_CANDIDATES = 40;

export class PostingsPublicAutocompleteService {
  private readonly logger: Logger;

  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly elasticsearch: ElasticsearchClient = getElasticsearchClient(),
  ) {
    this.logger = loggerFactory.forClass(
      PostingsPublicAutocompleteService,
      "service",
    );
  }

  async autocompletePublic(
    input: PostingAutocompleteInput,
  ): Promise<PostingAutocompleteResult> {
    const normalizedInput = {
      ...input,
      query: input.query.trim(),
    };

    if (this.elasticsearch.isEnabled()) {
      try {
        const suggestions =
          await this.autocompleteInElasticsearch(normalizedInput);

        return {
          query: normalizedInput.query,
          suggestions,
          source: "elasticsearch",
        };
      } catch (error) {
        if (error instanceof ElasticsearchCircuitOpenError) {
          this.logger.info(
            "Posting autocomplete using database fallback because Elasticsearch circuit is open.",
          );
        } else {
          this.logger.warn(
            "Posting autocomplete falling back to database.",
            undefined,
            error,
          );
        }
      }
    }

    const suggestions = await this.autocompleteInDatabase(normalizedInput);

    return {
      query: normalizedInput.query,
      suggestions,
      source: "database",
    };
  }

  private async autocompleteInElasticsearch(
    input: PostingAutocompleteInput,
  ): Promise<PostingAutocompleteSuggestion[]> {
    const indexName = `${this.elasticsearch.getPostingsIndexName()}-read`;
    const response =
      await this.elasticsearch.requestJson<ElasticsearchAutocompleteResponse>(
        `/${encodeURIComponent(indexName)}/_search`,
        {
          method: "POST",
          body: JSON.stringify(this.buildSearchRequest(input)),
        },
      );

    const documents = (
      response.hits?.hits ?? []
    ).map<AutocompleteCandidateDocument>((hit) => ({
      name: hit._source?.name,
      tags: hit._source?.tags ?? [],
      location: {
        city: hit._source?.location?.city,
        region: hit._source?.location?.region,
        country: hit._source?.location?.country,
      },
      publishedAt: hit._source?.publishedAt,
      createdAt: hit._source?.createdAt,
    }));

    return this.rankSuggestions(documents, input.query, input.limit);
  }

  private async autocompleteInDatabase(
    input: PostingAutocompleteInput,
  ): Promise<PostingAutocompleteSuggestion[]> {
    const documents =
      await this.postingsRepository.autocompletePublicFallback(input);
    return this.rankSuggestions(documents, input.query, input.limit);
  }

  private buildSearchRequest(
    input: PostingAutocompleteInput,
  ): Record<string, unknown> {
    const filter: Array<Record<string, unknown>> = [
      {
        term: {
          status: "published",
        },
      },
    ];

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

    return {
      size: this.resolveCandidateLimit(input.limit),
      _source: [
        "name",
        "tags",
        "location.city",
        "location.region",
        "location.country",
        "publishedAt",
        "createdAt",
      ],
      query: {
        bool: {
          must: [
            {
              bool: {
                should: [
                  {
                    multi_match: {
                      query: input.query,
                      type: "bool_prefix",
                      fields: [
                        "name.prefix^8",
                        "tags.prefix^6",
                        "location.city.prefix^5",
                        "location.region.prefix^4",
                        "location.country.prefix^3",
                      ],
                    },
                  },
                  {
                    multi_match: {
                      query: input.query,
                      type: "best_fields",
                      operator: "and",
                      fields: [
                        "name^6",
                        "tags.text^4",
                        "location.city^3",
                        "location.region^2",
                        "location.country^2",
                      ],
                      boost: 0.6,
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            },
          ],
          filter,
        },
      },
      sort: [
        {
          _score: {
            order: "desc",
          },
        },
        {
          publishedAt: {
            order: "desc",
          },
        },
        {
          createdAt: {
            order: "desc",
          },
        },
        {
          id: {
            order: "asc",
          },
        },
      ],
    };
  }

  private rankSuggestions(
    documents: AutocompleteCandidateDocument[],
    query: string,
    limit: number,
  ): PostingAutocompleteSuggestion[] {
    const normalizedQuery = this.normalizeAutocompleteText(query);
    const ranked = new Map<string, RankedSuggestion>();

    documents.forEach((document, documentRank) => {
      const publishedAtMs = this.toTimestamp(
        document.publishedAt ?? document.createdAt,
      );

      this.considerSuggestion(
        ranked,
        {
          value: document.name?.trim() ?? "",
          kind: "name",
          kindPriority: 0,
          documentRank,
          publishedAtMs,
        },
        normalizedQuery,
      );

      for (const tag of document.tags) {
        this.considerSuggestion(
          ranked,
          {
            value: tag.trim().toLowerCase(),
            kind: "tag",
            kindPriority: 1,
            documentRank,
            publishedAtMs,
          },
          normalizedQuery,
        );
      }

      const locationValue = this.formatLocationSuggestion(document.location);

      this.considerSuggestion(
        ranked,
        {
          value: locationValue,
          kind: "location",
          kindPriority: 2,
          documentRank,
          publishedAtMs,
        },
        normalizedQuery,
      );
    });

    return Array.from(ranked.values())
      .sort((left, right) => {
        if (left.kindPriority !== right.kindPriority) {
          return left.kindPriority - right.kindPriority;
        }

        if (left.documentRank !== right.documentRank) {
          return left.documentRank - right.documentRank;
        }

        if (left.publishedAtMs !== right.publishedAtMs) {
          return right.publishedAtMs - left.publishedAtMs;
        }

        return left.value.localeCompare(right.value);
      })
      .slice(0, limit)
      .map(({ value, kind }) => ({ value, kind }));
  }

  private considerSuggestion(
    ranked: Map<string, RankedSuggestion>,
    candidate: RankedSuggestion,
    normalizedQuery: string,
  ): void {
    const trimmedValue = candidate.value.trim();

    if (!trimmedValue) {
      return;
    }

    const normalizedValue = this.normalizeAutocompleteText(trimmedValue);

    if (!this.matchesNormalizedQuery(normalizedValue, normalizedQuery)) {
      return;
    }

    const existing = ranked.get(normalizedValue);

    if (
      existing &&
      (existing.kindPriority < candidate.kindPriority ||
        (existing.kindPriority === candidate.kindPriority &&
          existing.documentRank <= candidate.documentRank))
    ) {
      return;
    }

    ranked.set(normalizedValue, {
      ...candidate,
      value: trimmedValue,
    });
  }

  private formatLocationSuggestion(
    location: AutocompleteCandidateDocument["location"],
  ): string {
    const city = location.city?.trim();
    const region = location.region?.trim();
    const country = location.country?.trim();

    if (city && region) {
      return `${city}, ${region}`;
    }

    if (city) {
      return city;
    }

    if (region) {
      return region;
    }

    return country ?? "";
  }

  private normalizeAutocompleteText(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  private matchesNormalizedQuery(
    normalizedValue: string,
    normalizedQuery: string,
  ): boolean {
    if (normalizedValue.startsWith(normalizedQuery)) {
      return true;
    }

    return normalizedValue
      .split(/[^a-z0-9]+/g)
      .filter(Boolean)
      .some((token) => token.startsWith(normalizedQuery));
  }

  private resolveCandidateLimit(limit: number): number {
    return Math.min(
      Math.max(
        limit * AUTOCOMPLETE_CANDIDATE_LIMIT_MULTIPLIER,
        AUTOCOMPLETE_MIN_CANDIDATES,
      ),
      AUTOCOMPLETE_MAX_CANDIDATES,
    );
  }

  private toTimestamp(value?: string): number {
    if (!value) {
      return 0;
    }

    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
