import { ElasticsearchUnavailableError } from "@/configuration/resources/elasticsearch";
import { ElasticsearchCircuitOpenError } from "@/configuration/resources/elasticsearch";
import {
  publicAutocompletePostingsQuerySchema,
  type PostingAutocompleteInput,
} from "@/features/postings/postings.model";
import { PostingsRepository } from "@/features/postings/postings.repository";
import { PostingsPublicAutocompleteService } from "@/features/postings/search/autocomplete.service";
import { PostingsSearchIndexService } from "@/features/postings/search/index.service";

function createElasticsearchAutocompleteService(response: unknown | unknown[]) {
  const autocompletePublicFallback = jest.fn(async () => []);
  const requestJson = jest.fn();
  const responses = Array.isArray(response) ? response : [response];
  responses.forEach((item) => requestJson.mockResolvedValueOnce(item));
  requestJson.mockResolvedValue(responses[responses.length - 1]);
  const repository = {
    autocompletePublicFallback,
  } as unknown as PostingsRepository;
  const service = new PostingsPublicAutocompleteService(repository, {
    getPostingsIndexName: () => "postings-test",
    requestJson,
    isEnabled: () => true,
  } as any);

  return {
    autocompletePublicFallback,
    requestJson,
    service,
  };
}

function readAutocompleteRequestBody(
  requestJson: jest.Mock,
  callIndex = 0,
): {
  query: {
    bool: {
      must: Array<{
        bool: {
          should: Array<Record<string, unknown>>;
        };
      }>;
      filter: unknown[];
    };
  };
} {
  return JSON.parse(requestJson.mock.calls[callIndex]?.[1]?.body as string);
}

describe("publicAutocompletePostingsQuerySchema", () => {
  it("requires a 2+ character query and caps the limit", () => {
    expect(
      publicAutocompletePostingsQuerySchema.parse({
        q: " tor ",
        family: "place",
        subtype: "workspace",
        limit: "8",
      }),
    ).toEqual({
      q: "tor",
      family: "place",
      subtype: "workspace",
      limit: 8,
    });

    const shortQuery = publicAutocompletePostingsQuerySchema.safeParse({
      q: "t",
    });
    expect(shortQuery.success).toBe(false);

    const oversizedLimit = publicAutocompletePostingsQuerySchema.safeParse({
      q: "tor",
      limit: "9",
    });
    expect(oversizedLimit.success).toBe(false);
  });
});

describe("PostingsPublicAutocompleteService", () => {
  it("adds family and subtype filters to the Elasticsearch autocomplete query", async () => {
    const { requestJson, service } = createElasticsearchAutocompleteService({
      hits: {
        hits: [],
      },
    });

    await service.autocompletePublic({
      query: "tor",
      family: "vehicle",
      subtype: "car",
      limit: 6,
    });

    const body = readAutocompleteRequestBody(requestJson);

    expect(body.query.bool.filter).toEqual(
      expect.arrayContaining([
        {
          term: {
            family: "vehicle",
          },
        },
        {
          term: {
            subtype: "car",
          },
        },
      ]),
    );
  });

  it("retries zero-hit autocomplete searches with a tolerant fuzzy clause", async () => {
    const { requestJson, service } = createElasticsearchAutocompleteService([
      {
        hits: {
          hits: [],
        },
      },
      {
        hits: {
          hits: [
            {
              _id: "posting-1",
              _source: {
                name: "North Shore Adventure Bike",
                tags: ["bike", "mountain", "northshore"],
                location: {
                  city: "North Vancouver",
                  region: "British Columbia",
                  country: "Canada",
                },
                publishedAt: "2026-05-01T00:00:00.000Z",
                createdAt: "2026-05-01T00:00:00.000Z",
              },
            },
          ],
        },
      },
    ]);

    const result = await service.autocompletePublic({
      query: "borth",
      limit: 6,
    });

    expect(requestJson).toHaveBeenCalledTimes(2);

    const strictShouldClauses =
      readAutocompleteRequestBody(requestJson, 0).query.bool.must[0]?.bool
        .should ?? [];
    const tolerantShouldClauses =
      readAutocompleteRequestBody(requestJson, 1).query.bool.must[0]?.bool
        .should ?? [];

    expect(
      strictShouldClauses.some(
        (clause) =>
          typeof clause === "object" &&
          clause !== null &&
          "multi_match" in clause &&
          (clause.multi_match as { fuzziness?: string }).fuzziness === "AUTO",
      ),
    ).toBe(false);

    const tolerantFuzzyClause = tolerantShouldClauses.find(
      (clause) =>
        typeof clause === "object" &&
        clause !== null &&
        "multi_match" in clause &&
        (clause.multi_match as { fuzziness?: string }).fuzziness === "AUTO",
    ) as { multi_match: Record<string, unknown> } | undefined;

    expect(tolerantFuzzyClause?.multi_match).toMatchObject({
      prefix_length: 0,
      max_expansions: 25,
      boost: 0.4,
    });
    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        { value: "North Shore Adventure Bike", kind: "name" },
        { value: "North Vancouver, British Columbia", kind: "location" },
      ]),
    );
  });

  it("does not retry autocomplete searches when the strict query already has hits", async () => {
    const { requestJson, service } = createElasticsearchAutocompleteService({
      hits: {
        hits: [
          {
            _id: "posting-1",
            _source: {
              name: "North Shore Adventure Bike",
              tags: ["bike"],
              location: {
                city: "North Vancouver",
                region: "British Columbia",
                country: "Canada",
              },
              publishedAt: "2026-05-01T00:00:00.000Z",
              createdAt: "2026-05-01T00:00:00.000Z",
            },
          },
        ],
      },
    });

    await service.autocompletePublic({
      query: "north",
      limit: 6,
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it("ranks and deduplicates suggestions by kind priority, relevance order, and location formatting", async () => {
    const { service } = createElasticsearchAutocompleteService({
      hits: {
        hits: [
          {
            _id: "posting-1",
            _source: {
              name: "Sunny Loft",
              tags: ["weekend"],
              location: {
                city: "Toronto",
                region: "Ontario",
                country: "Canada",
              },
              publishedAt: "2026-05-01T00:00:00.000Z",
              createdAt: "2026-05-01T00:00:00.000Z",
            },
          },
          {
            _id: "posting-2",
            _source: {
              name: "Toronto Creator Studio",
              tags: ["toronto", "creator"],
              location: {
                city: "Toronto",
                region: "Ontario",
                country: "Canada",
              },
              publishedAt: "2026-05-02T00:00:00.000Z",
              createdAt: "2026-05-02T00:00:00.000Z",
            },
          },
          {
            _id: "posting-3",
            _source: {
              name: "Tool Cage",
              tags: ["toronto"],
              location: {
                region: "Ontario",
                country: "Canada",
              },
              publishedAt: "2026-05-03T00:00:00.000Z",
              createdAt: "2026-05-03T00:00:00.000Z",
            },
          },
        ],
      },
    });

    const result = await service.autocompletePublic({
      query: "tor",
      limit: 6,
    });

    expect(result).toEqual({
      query: "tor",
      source: "elasticsearch",
      suggestions: [
        { value: "Toronto Creator Studio", kind: "name" },
        { value: "toronto", kind: "tag" },
        { value: "Toronto, Ontario", kind: "location" },
      ],
    });
  });

  it("falls back to the database when Elasticsearch is unavailable", async () => {
    const autocompletePublicFallback = jest.fn(
      async (input: PostingAutocompleteInput) => [
        {
          name: "Toronto Loft",
          tags: ["toronto", "loft"],
          location: {
            city: "Toronto",
            region: "Ontario",
            country: "Canada",
          },
          publishedAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    );
    const service = new PostingsPublicAutocompleteService(
      {
        autocompletePublicFallback,
      } as unknown as PostingsRepository,
      {
        getPostingsIndexName: () => "postings-test",
        requestJson: jest.fn(async () => {
          throw new ElasticsearchUnavailableError(
            "Elasticsearch is unavailable.",
          );
        }),
        isEnabled: () => true,
      } as any,
    );

    const result = await service.autocompletePublic({
      query: "tor",
      family: "place",
      subtype: "workspace",
      limit: 6,
    });

    expect(result.source).toBe("database");
    expect(autocompletePublicFallback).toHaveBeenCalledWith({
      query: "tor",
      family: "place",
      subtype: "workspace",
      limit: 6,
    });
    expect(result.suggestions).toEqual([
      { value: "Toronto Loft", kind: "name" },
      { value: "toronto", kind: "tag" },
      { value: "Toronto, Ontario", kind: "location" },
    ]);
  });

  it("falls back to the database when the Elasticsearch circuit is open", async () => {
    const autocompletePublicFallback = jest.fn(
      async (input: PostingAutocompleteInput) => [
        {
          name: "Toronto Loft",
          tags: ["toronto"],
          location: {
            city: "Toronto",
          },
          publishedAt: "2026-05-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    );
    const service = new PostingsPublicAutocompleteService(
      {
        autocompletePublicFallback,
      } as unknown as PostingsRepository,
      {
        getPostingsIndexName: () => "postings-test",
        requestJson: jest.fn(async () => {
          throw new ElasticsearchCircuitOpenError(new Date());
        }),
        isEnabled: () => true,
      } as any,
    );

    const result = await service.autocompletePublic({
      query: " tor ",
      limit: 6,
    });

    expect(result).toEqual({
      query: "tor",
      source: "database",
      suggestions: [
        { value: "Toronto Loft", kind: "name" },
        { value: "toronto", kind: "tag" },
      ],
    });
    expect(autocompletePublicFallback).toHaveBeenCalledWith({
      query: "tor",
      limit: 6,
    });
  });

  it("clamps Elasticsearch candidate limits between the configured minimum and maximum", async () => {
    const { requestJson, service } = createElasticsearchAutocompleteService({
      hits: {
        hits: [
          {
            _id: "posting-1",
            _source: {
              name: "Toronto Loft",
              tags: ["toronto"],
              location: {
                city: "Toronto",
              },
              publishedAt: "2026-05-01T00:00:00.000Z",
              createdAt: "2026-05-01T00:00:00.000Z",
            },
          },
        ],
      },
    });

    await service.autocompletePublic({
      query: "tor",
      limit: 1,
    });
    await service.autocompletePublic({
      query: "tor",
      limit: 8,
    });

    expect(readAutocompleteRequestBody(requestJson, 0)).toMatchObject({
      size: 12,
    });
    expect(readAutocompleteRequestBody(requestJson, 1)).toMatchObject({
      size: 40,
    });
  });

  it("covers autocomplete helper ranking, formatting, and fuzzy guard branches", () => {
    const { service } = createElasticsearchAutocompleteService({} as any);
    const helper = service as unknown as {
      rankSuggestions(
        documents: Array<{
          name?: string;
          tags: string[];
          location: {
            city?: string;
            region?: string;
            country?: string;
          };
          publishedAt?: string;
          createdAt?: string;
        }>,
        query: string,
        limit: number,
        mode: "strict" | "tolerant",
      ): Array<{ value: string; kind: string }>;
      formatLocationSuggestion(location: {
        city?: string;
        region?: string;
        country?: string;
      }): string;
      matchesNormalizedQuery(
        normalizedValue: string,
        normalizedQuery: string,
        mode: "strict" | "tolerant",
      ): boolean;
      resolveCandidateLimit(limit: number): number;
      toTimestamp(value?: string): number;
      resolveFuzzyDistance(normalizedQuery: string): number;
    };

    expect(helper.resolveCandidateLimit(1)).toBe(12);
    expect(helper.resolveCandidateLimit(8)).toBe(40);
    expect(helper.toTimestamp()).toBe(0);
    expect(helper.toTimestamp("not-a-date")).toBe(0);
    expect(helper.resolveFuzzyDistance("to")).toBe(-1);
    expect(helper.resolveFuzzyDistance("north")).toBe(1);
    expect(helper.resolveFuzzyDistance("toronto")).toBe(2);
    expect(helper.matchesNormalizedQuery("camera", "to", "tolerant")).toBe(
      false,
    );
    expect(
      helper.rankSuggestions(
        [
          {
            name: "   ",
            tags: ["apricot"],
            location: {},
            createdAt: "invalid",
          },
          {
            tags: ["apple"],
            location: {
              city: " Toronto ",
            },
            createdAt: "2026-05-02T00:00:00.000Z",
          },
          {
            tags: ["azure", "atlas"],
            location: {
              country: " Canada ",
            },
            createdAt: "2026-05-02T00:00:00.000Z",
          },
        ],
        "a",
        10,
        "strict",
      ),
    ).toEqual([
      { value: "apricot", kind: "tag" },
      { value: "apple", kind: "tag" },
      { value: "atlas", kind: "tag" },
      { value: "azure", kind: "tag" },
    ]);
    expect(
      helper.formatLocationSuggestion({
        city: " Toronto ",
      }),
    ).toBe("Toronto");
    expect(
      helper.formatLocationSuggestion({
        country: " Canada ",
      }),
    ).toBe("Canada");
  });
});

describe("PostingsSearchIndexService", () => {
  it("adds an autocomplete prefix field for tags", async () => {
    const requestJson = jest.fn(async () => undefined);
    const service = new PostingsSearchIndexService({
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as any);

    await service.createVersionedIndex();

    const body = JSON.parse((requestJson.mock.calls[0] as any)?.[1]?.body as string) as {
      mappings: {
        properties: {
          tags: {
            fields: Record<string, unknown>;
          };
        };
      };
    };

    expect(body.mappings.properties.tags.fields).toEqual(
      expect.objectContaining({
        prefix: {
          type: "text",
          analyzer: "autocomplete_index",
          search_analyzer: "autocomplete_search",
        },
      }),
    );
  });
});
