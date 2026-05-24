import { PostingsSearchIndexService } from "@/features/postings/search/index.service";
import { PostingsPublicSearchService } from "@/features/postings/search/public-search.service";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import { PostingsRepository } from "@/features/postings/postings.repository";
import type { PostingSearchDocument } from "@/features/postings/postings.model";
import { ElasticsearchUnavailableError } from "@/configuration/resources/elasticsearch";
import { resetSearchTelemetry } from "@/features/search/search.telemetry";

interface CapturedSql {
  sql: string;
  values: unknown[];
}

function createDocument(
  overrides: Partial<PostingSearchDocument> = {},
): PostingSearchDocument {
  return {
    id: "posting-1",
    ownerId: "owner-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    tags: ["loft", "workspace"],
    availabilityStatus: "available",
    searchableAttributes: {
      bedrooms: 2,
      amenities: ["wifi", "desk"],
    },
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    pricingCurrency: "CAD",
    location: {
      latitude: 43.6532,
      longitude: -79.3832,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    photos: [
      {
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        position: 0,
      },
    ],
    blockedRanges: [],
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    publishedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function createElasticsearchPublicSearchService() {
  const getPublicByIds = jest.fn(async () => ({
    postings: [],
    missingIds: [],
  }));
  const repository = {
    searchPublicFallback: jest.fn(),
    batchFindPublic: jest.fn(async ({ ids }: { ids: string[] }) => ({
      postings: [],
      missingIds: ids,
    })),
  } as unknown as PostingsRepository;
  const requestJson = jest.fn(async () => ({
    hits: {
      total: {
        value: 0,
      },
      hits: [],
    },
  }));
  const postingsPublicCacheService = {
    getPublicByIds,
  } as unknown as PostingsPublicCacheService;
  const service = new PostingsPublicSearchService(repository, postingsPublicCacheService, {
    getPostingsIndexName: () => "postings-test",
    requestJson,
    isEnabled: () => true,
  } as never);

  return {
    getPublicByIds,
    requestJson,
    service,
  };
}

function createSearchHydrationService(overrides?: {
  requestJson?: jest.Mock;
  getPublicByIds?: jest.Mock;
  batchFindPublic?: jest.Mock;
}) {
  const requestJson =
    overrides?.requestJson ??
    jest.fn(async () => ({
      hits: {
        total: {
          value: 0,
        },
        hits: [],
      },
    }));
  const getPublicByIds =
    overrides?.getPublicByIds ??
    jest.fn(async () => ({
      postings: [],
      missingIds: [],
    }));
  const batchFindPublic =
    overrides?.batchFindPublic ??
    jest.fn(async ({ ids }: { ids: string[] }) => ({
      postings: [],
      missingIds: ids,
    }));
  const repository = {
    searchPublicFallback: jest.fn(),
    batchFindPublic,
  } as unknown as PostingsRepository;
  const service = new PostingsPublicSearchService(repository, {
    getPublicByIds,
  } as unknown as PostingsPublicCacheService, {
    getPostingsIndexName: () => "postings-test",
    requestJson,
    isEnabled: () => true,
  } as never);

  return {
    batchFindPublic,
    getPublicByIds,
    requestJson,
    service,
  };
}

function readSearchRequest(requestJson: jest.Mock): {
  query: {
    bool: {
      must: Array<{
        bool: {
          should: Array<Record<string, unknown>>;
        };
      }>;
      filter: unknown[];
      must_not?: unknown[];
    };
  };
  sort: unknown[];
} {
  return JSON.parse(requestJson.mock.calls[0]?.[1]?.body as string);
}

function readKeywordShouldClauses(requestJson: jest.Mock): Array<Record<string, unknown>> {
  return readSearchRequest(requestJson).query.bool.must[0]?.bool.should ?? [];
}

function createPublicPosting(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    ownerId: "owner-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    pricingCurrency: "CAD",
    photos: [],
    tags: ["loft", "workspace"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi", "desk"],
    },
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      latitude: 43.65,
      longitude: -79.38,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    publishedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function createFallbackRepository() {
  const queries: CapturedSql[] = [];
  let callCount = 0;
  const $queryRaw = jest.fn(async (query: { sql: string; values: unknown[] }) => {
    queries.push({
      sql: query.sql,
      values: query.values,
    });
    callCount += 1;
    return callCount === 1 ? [{ total: 0 }] : [];
  });
  const repository = new PostingsRepository({
    $queryRaw,
  } as never);

  return {
    queries,
    repository,
  };
}

describe("PostingsSearchIndexService", () => {
  beforeEach(() => {
    resetSearchTelemetry();
  });

  it("indexes family, subtype, and searchable attributes into Elasticsearch documents", async () => {
    const requestJson = jest.fn(async () => undefined);
    const service = new PostingsSearchIndexService({
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as never);

    await service.upsertDocument(createDocument(), "postings-test_v1");

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson.mock.calls[0]?.[0]).toBe("/postings-test_v1/_doc/posting-1");

    const body = JSON.parse(requestJson.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;

    expect(body).toMatchObject({
      family: "place",
      subtype: "entire_place",
      searchableAttributes: {
        bedrooms: 2,
        amenities: ["wifi", "desk"],
      },
    });
    expect(body).not.toHaveProperty("attributes");
  });

  it("repairs a missing read alias from the write alias target", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        postings_test_v1: {},
      })
      .mockResolvedValueOnce({});
    const service = new PostingsSearchIndexService({
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as never);

    await service.ensureLiveIndex();

    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "/_aliases",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(requestJson.mock.calls[2]?.[1]?.body as string)).toEqual({
      actions: [
        {
          add: {
            index: "postings_test_v1",
            alias: "postings-test-read",
          },
        },
      ],
    });
  });

  it("fails closed when read and write aliases target different indices", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({
        postings_test_read: {},
      })
      .mockResolvedValueOnce({
        postings_test_write: {},
      });
    const service = new PostingsSearchIndexService({
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as never);

    await expect(service.ensureLiveIndex()).rejects.toBeInstanceOf(ElasticsearchUnavailableError);
  });
});

describe("PostingsPublicSearchService", () => {
  beforeEach(() => {
    resetSearchTelemetry();
  });

  it("adds family and subtype filters to Elasticsearch search requests", async () => {
    const { getPublicByIds, requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "loft",
      family: "vehicle",
      subtype: "car",
      sort: "relevance",
    });

    const body = readSearchRequest(requestJson);

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
    expect(getPublicByIds).toHaveBeenCalledWith([]);
  });

  it("uses strict cross-field matching for multi-term Elasticsearch keyword searches", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "Saint-Roch Production Flat",
      sort: "relevance",
    });

    const shouldClauses = readKeywordShouldClauses(requestJson);

    expect(shouldClauses).toEqual(
      expect.arrayContaining([
        {
          multi_match: {
            query: "Saint-Roch Production Flat",
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
            query: "Saint-Roch Production Flat",
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
            operator: "and",
            boost: 0.7,
          },
        },
        {
          multi_match: {
            query: "Saint-Roch Production Flat",
            type: "bool_prefix",
            fields: [
              "name.prefix^4",
              "location.city.prefix^3",
              "location.region.prefix^2",
              "location.country.prefix^2",
            ],
            operator: "and",
            boost: 0.8,
          },
        },
      ]),
    );
  });

  it("keeps looser fuzzy and prefix matching for single-term Elasticsearch keyword searches", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "production",
      sort: "relevance",
    });

    const shouldClauses = readKeywordShouldClauses(requestJson);
    const fuzzyClause = shouldClauses.find(
      (clause) =>
        typeof clause === "object" &&
        clause !== null &&
        "multi_match" in clause &&
        (clause.multi_match as { fuzziness?: string }).fuzziness === "AUTO",
    ) as { multi_match: Record<string, unknown> } | undefined;
    const prefixClause = shouldClauses.find(
      (clause) =>
        typeof clause === "object" &&
        clause !== null &&
        "multi_match" in clause &&
        (clause.multi_match as { type?: string }).type === "bool_prefix",
    ) as { multi_match: Record<string, unknown> } | undefined;

    expect(shouldClauses).toEqual(
      expect.arrayContaining([
        {
          multi_match: {
            query: "production",
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
      ]),
    );
    expect(fuzzyClause).toBeDefined();
    expect(fuzzyClause?.multi_match).not.toHaveProperty("operator");
    expect(prefixClause).toBeDefined();
    expect(prefixClause?.multi_match).not.toHaveProperty("operator");
  });

  it("preserves Elasticsearch relevance order when hydrating cached and uncached postings", async () => {
    const { batchFindPublic, getPublicByIds, service } = createSearchHydrationService({
      requestJson: jest.fn(async () => ({
        hits: {
          total: {
            value: 3,
          },
          hits: [
            { _id: "posting-3" },
            { _id: "posting-1" },
            { _id: "posting-2" },
          ],
        },
      })),
      getPublicByIds: jest.fn(async () => ({
        postings: [
          createPublicPosting({
            id: "posting-1",
            name: "Gastown Production Loft",
          }),
          createPublicPosting({
            id: "posting-3",
            name: "Saint-Roch Production Flat",
          }),
        ],
        missingIds: ["posting-2"],
      })),
      batchFindPublic: jest.fn(async () => ({
        postings: [
          createPublicPosting({
            id: "posting-2",
            name: "Beltline Designer Flat",
          }),
        ],
        missingIds: [],
      })),
    });

    const result = await service.searchPublic({
      page: 1,
      pageSize: 10,
      query: "Saint-Roch Production Flat",
      sort: "relevance",
    });

    expect(result.postings.map((posting) => posting.id)).toEqual([
      "posting-3",
      "posting-1",
      "posting-2",
    ]);
    expect(result.postings.map((posting) => posting.name)).toEqual([
      "Saint-Roch Production Flat",
      "Gastown Production Loft",
      "Beltline Designer Flat",
    ]);
    expect(getPublicByIds).toHaveBeenCalledWith(["posting-3", "posting-1", "posting-2"]);
    expect(batchFindPublic).toHaveBeenCalledWith({
      ids: ["posting-2"],
    });
  });

  it("requires every requested tag in Elasticsearch search requests", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      tags: ["loft", "workspace"],
      sort: "relevance",
    });

    const body = readSearchRequest(requestJson);

    expect(body.query.bool.filter).toEqual(
      expect.arrayContaining([
        {
          bool: {
            filter: [
              {
                term: {
                  tags: "loft",
                },
              },
              {
                term: {
                  tags: "workspace",
                },
              },
            ],
          },
        },
      ]),
    );
  });

  it("adds price, geo radius, and nearest sort clauses to Elasticsearch search requests", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      minDailyPrice: 100,
      maxDailyPrice: 200,
      geo: {
        latitude: 43.6532,
        longitude: -79.3832,
        radiusKm: 12,
      },
      sort: "nearest",
    });

    const body = readSearchRequest(requestJson);

    expect(body.query.bool.filter).toEqual(
      expect.arrayContaining([
        {
          range: {
            dailyPriceAmount: {
              gte: 100,
              lte: 200,
            },
          },
        },
        {
          geo_distance: {
            distance: "12km",
            geoPoint: {
              lat: 43.6532,
              lon: -79.3832,
            },
          },
        },
      ]),
    );
    expect(body.sort).toEqual([
      {
        _geo_distance: {
          geoPoint: {
            lat: 43.6532,
            lon: -79.3832,
          },
          order: "asc",
          unit: "km",
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
    ]);
  });

  it("adds oldest and alphabetical sort clauses to Elasticsearch search requests", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      sort: "oldest",
    });

    let body = readSearchRequest(requestJson);

    expect(body.sort).toEqual([
      {
        publishedAt: {
          order: "asc",
        },
      },
      {
        createdAt: {
          order: "asc",
        },
      },
      {
        id: {
          order: "asc",
        },
      },
    ]);

    requestJson.mockClear();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      sort: "nameAsc",
    });

    body = readSearchRequest(requestJson);

    expect(body.sort).toEqual([
      {
        "name.sort": {
          order: "asc",
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
    ]);

    requestJson.mockClear();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      sort: "nameDesc",
    });

    body = readSearchRequest(requestJson);

    expect(body.sort).toEqual([
      {
        "name.sort": {
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
    ]);
  });

  it("excludes overlapping blocked ranges when availability search is provided", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 10,
      sort: "relevance",
      availabilityWindow: {
        startAt: "2026-04-21T00:00:00.000Z",
        endAt: "2026-04-24T00:00:00.000Z",
      },
    });

    const body = readSearchRequest(requestJson);

    expect(body.query.bool.must_not).toEqual(
      expect.arrayContaining([
        {
          nested: {
            path: "blockedRanges",
            query: {
              bool: {
                filter: [
                  {
                    range: {
                      "blockedRanges.startAt": {
                        lt: "2026-04-24T00:00:00.000Z",
                      },
                    },
                  },
                  {
                    range: {
                      "blockedRanges.endAt": {
                        gt: "2026-04-21T00:00:00.000Z",
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ]),
    );
  });

  it("adds structured attribute filters to Elasticsearch search requests", async () => {
    const { requestJson, service } = createElasticsearchPublicSearchService();

    await service.searchPublic({
      page: 1,
      pageSize: 20,
      family: "place",
      subtype: "entire_place",
      attributeFilters: [
        {
          key: "bedrooms",
          min: 2,
          max: 4,
        },
        {
          key: "amenities",
          value: ["wifi", "desk"],
        },
      ],
      sort: "relevance",
    });

    const body = readSearchRequest(requestJson);

    expect(body.query.bool.filter).toEqual(
      expect.arrayContaining([
        {
          range: {
            "searchableAttributes.bedrooms": {
              gte: 2,
              lte: 4,
            },
          },
        },
        {
          bool: {
            filter: [
              {
                term: {
                  "searchableAttributes.amenities": "wifi",
                },
              },
              {
                term: {
                  "searchableAttributes.amenities": "desk",
                },
              },
            ],
          },
        },
      ]),
    );
  });

  it("falls back to database search when Elasticsearch is unavailable", async () => {
    const getPublicByIds = jest.fn(async () => ({
      postings: [],
      missingIds: ["posting-1"],
    }));
    const batchFindPublic = jest.fn(async ({ ids }: { ids: string[] }) => ({
      postings: [],
      missingIds: ids,
    }));
    const searchPublicFallback = jest.fn(async () => ({
      ids: ["posting-1"],
      total: 1,
    }));
    const repository = {
      searchPublicFallback,
      batchFindPublic,
    } as unknown as PostingsRepository;
    const requestJson = jest.fn(async () => {
      throw new ElasticsearchUnavailableError("Elasticsearch is unavailable.");
    });
    const service = new PostingsPublicSearchService(repository, {
      getPublicByIds,
    } as unknown as PostingsPublicCacheService, {
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as never);

    const result = await service.searchPublic({
      page: 1,
      pageSize: 10,
      query: "loft",
      sort: "relevance",
    });

    expect(result.source).toBe("database");
    expect(searchPublicFallback).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      query: "loft",
      sort: "relevance",
    });
    expect(getPublicByIds).toHaveBeenCalledWith(["posting-1"]);
    expect(batchFindPublic).toHaveBeenCalledWith({
      ids: ["posting-1"],
    });
  });

  it("falls back to database search when Elasticsearch returns stale ids", async () => {
    const getPublicByIds = jest
      .fn()
      .mockResolvedValueOnce({
        postings: [],
        missingIds: ["posting-1"],
      })
      .mockResolvedValueOnce({
        postings: [],
        missingIds: [],
      });
    const batchFindPublic = jest
      .fn()
      .mockResolvedValueOnce({
        postings: [],
        missingIds: ["posting-1"],
      })
      .mockResolvedValueOnce({
        postings: [],
        missingIds: ["posting-2"],
      });
    const searchPublicFallback = jest.fn(async () => ({
      ids: ["posting-2"],
      total: 1,
    }));
    const repository = {
      searchPublicFallback,
      batchFindPublic,
    } as unknown as PostingsRepository;
    const requestJson = jest.fn(async () => ({
      hits: {
        total: {
          value: 1,
        },
        hits: [
          {
            _id: "posting-1",
          },
        ],
      },
    }));
    const service = new PostingsPublicSearchService(repository, {
      getPublicByIds,
    } as unknown as PostingsPublicCacheService, {
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as never);

    const result = await service.searchPublic({
      page: 1,
      pageSize: 10,
      query: "loft",
      sort: "relevance",
    });

    expect(result.source).toBe("database");
    expect(searchPublicFallback).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      query: "loft",
      sort: "relevance",
    });
    expect(getPublicByIds).toHaveBeenNthCalledWith(1, ["posting-1"]);
    expect(getPublicByIds).toHaveBeenNthCalledWith(2, ["posting-2"]);
    expect(batchFindPublic).toHaveBeenNthCalledWith(1, {
      ids: ["posting-1"],
    });
    expect(batchFindPublic).toHaveBeenCalledTimes(1);
  });

  it("repairs cache misses from the repository without returning a short page", async () => {
    const repository = {
      searchPublicFallback: jest.fn(),
      batchFindPublic: jest.fn(async () => ({
        postings: [createPublicPosting()],
        missingIds: [],
      })),
    } as unknown as PostingsRepository;
    const service = new PostingsPublicSearchService(repository, {
      getPublicByIds: jest.fn(async () => ({
        postings: [],
        missingIds: ["posting-1"],
      })),
    } as unknown as PostingsPublicCacheService, {
      getPostingsIndexName: () => "postings-test",
      requestJson: jest.fn(async () => ({
        hits: {
          total: {
            value: 1,
          },
          hits: [
            {
              _id: "posting-1",
            },
          ],
        },
      })),
      isEnabled: () => true,
    } as never);

    const result = await service.searchPublic({
      page: 1,
      pageSize: 10,
      sort: "relevance",
    });

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.id).toBe("posting-1");
    expect(repository.batchFindPublic).toHaveBeenCalledWith({
      ids: ["posting-1"],
    });
  });

  it("caps pagination metadata at the maximum supported search window", async () => {
    const requestJson = jest.fn(async () => ({
      hits: {
        total: {
          value: 25_000,
        },
        hits: [],
      },
    }));
    const service = new PostingsPublicSearchService(
      {
        searchPublicFallback: jest.fn(),
      } as unknown as PostingsRepository,
      {
        getPublicByIds: jest.fn(async () => ({
          postings: [],
          missingIds: [],
        })),
      } as unknown as PostingsPublicCacheService,
      {
        getPostingsIndexName: () => "postings-test",
        requestJson,
        isEnabled: () => true,
      } as never,
    );

    const result = await service.searchPublic({
      page: 200,
      pageSize: 50,
      sort: "relevance",
    });

    expect(result.pagination).toMatchObject({
      page: 200,
      pageSize: 50,
      total: 25_000,
      totalPages: 200,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });
});

describe("PostingsRepository.searchPublicFallback", () => {
  it("applies equivalent filters for tags, price, geo radius, availability, and nearest sorting", async () => {
    const { queries, repository } = createFallbackRepository();

    await repository.searchPublicFallback({
      page: 1,
      pageSize: 10,
      family: "place",
      subtype: "entire_place",
      tags: ["loft", "workspace"],
      availabilityStatus: "available",
      attributeFilters: [
        {
          key: "bedrooms",
          min: 2,
          max: 4,
        },
        {
          key: "amenities",
          value: ["wifi", "desk"],
        },
      ],
      minDailyPrice: 100,
      maxDailyPrice: 200,
      geo: {
        latitude: 43.6532,
        longitude: -79.3832,
        radiusKm: 12,
      },
      availabilityWindow: {
        startAt: "2026-04-21T00:00:00.000Z",
        endAt: "2026-04-24T00:00:00.000Z",
      },
      sort: "nearest",
    });

    const idQuery = queries[1]!;

    expect((idQuery.sql.match(/JSON_SEARCH\(tags, 'one', \?\) IS NOT NULL/g) ?? []).length).toBe(2);
    expect(idQuery.sql).toContain("family = ?");
    expect(idQuery.sql).toContain("subtype = ?");
    expect(idQuery.sql).toContain("availability_status = ?");
    expect(idQuery.sql).toContain("JSON_EXTRACT(place_details, ?)");
    expect(idQuery.sql).toContain("JSON_EXTRACT(pricing, '$.daily.amount')) AS DECIMAL(18, 2)) >= ?");
    expect(idQuery.sql).toContain("JSON_EXTRACT(pricing, '$.daily.amount')) AS DECIMAL(18, 2)) <= ?");
    expect(idQuery.sql).toContain("pab.start_at < ?");
    expect(idQuery.sql).toContain("br.start_at < ?");
    expect(idQuery.sql).toContain("r.start_at < ?");
    expect(idQuery.sql).toContain("6371 * ACOS");
    expect(idQuery.sql).toContain("<= ?");
    expect(idQuery.sql).toContain("ORDER BY (");
    expect(idQuery.sql).toContain("ASC, published_at DESC, created_at DESC, id ASC");
    expect(idQuery.values).toEqual(
      expect.arrayContaining([
        "place",
        "entire_place",
        "loft",
        "workspace",
        "available",
        "$.bedrooms",
        2,
        4,
        "$.amenities",
        "wifi",
        "desk",
        100,
        200,
        12,
      ]),
    );
  });

  it("uses case-insensitive exact matching for searchable string and string-array attribute filters", async () => {
    const { queries, repository } = createFallbackRepository();

    await repository.searchPublicFallback({
      page: 1,
      pageSize: 10,
      family: "place",
      subtype: "entire_place",
      attributeFilters: [
        {
          key: "property_type",
          value: "condo",
        },
        {
          key: "amenities",
          value: ["wifi", "desk"],
        },
      ],
      sort: "relevance",
    });

    const idQuery = queries[1]!;

    expect(idQuery.sql).toContain("LOWER(JSON_UNQUOTE(JSON_EXTRACT(place_details, ?))) = ?");
    expect(idQuery.sql).toContain("FROM JSON_TABLE(");
    expect(idQuery.sql).toContain("LOWER(attribute_values.value) = ?");
    expect(idQuery.values).toEqual(expect.arrayContaining(["$.property_type", "condo", "$.amenities", "wifi", "desk"]));
  });

  it("uses field-priority relevance ordering for keyword fallback searches", async () => {
    const { queries, repository } = createFallbackRepository();

    await repository.searchPublicFallback({
      page: 1,
      pageSize: 10,
      query: "100%_loft",
      sort: "relevance",
    });

    const idQuery = queries[1]!;

    expect(idQuery.sql).toContain("ORDER BY (");
    expect(idQuery.sql).toContain("CASE WHEN name LIKE ? ESCAPE '\\'");
    expect(idQuery.sql).toContain("CASE WHEN CAST(tags AS CHAR) LIKE ? ESCAPE '\\'");
    expect(idQuery.sql).toContain("CASE WHEN description LIKE ? ESCAPE '\\'");
    expect(idQuery.sql).toContain("CASE WHEN city LIKE ? ESCAPE '\\'");
    expect(idQuery.sql).toContain("CASE WHEN region LIKE ? ESCAPE '\\'");
    expect(idQuery.sql).toContain("CASE WHEN country LIKE ? ESCAPE '\\'");
    expect(idQuery.sql).toContain(") DESC, published_at DESC, created_at DESC, id ASC");
    expect(idQuery.values.filter((value) => value === "%100\\%\\_loft%")).toHaveLength(12);
  });

  it("supports oldest and alphabetical fallback ordering with stable tie-breakers", async () => {
    const { queries, repository } = createFallbackRepository();

    await repository.searchPublicFallback({
      page: 1,
      pageSize: 10,
      sort: "oldest",
    });

    let idQuery = queries[1]!;
    expect(idQuery.sql).toContain("ORDER BY published_at ASC, created_at ASC, id ASC");

    queries.length = 0;

    await repository.searchPublicFallback({
      page: 1,
      pageSize: 10,
      sort: "nameAsc",
    });

    idQuery = queries[1]!;
    expect(idQuery.sql).toContain("ORDER BY LOWER(name) ASC, published_at DESC, created_at DESC, id ASC");

    queries.length = 0;

    await repository.searchPublicFallback({
      page: 1,
      pageSize: 10,
      sort: "nameDesc",
    });

    idQuery = queries[1]!;
    expect(idQuery.sql).toContain("ORDER BY LOWER(name) DESC, published_at DESC, created_at DESC, id ASC");
  });
});
