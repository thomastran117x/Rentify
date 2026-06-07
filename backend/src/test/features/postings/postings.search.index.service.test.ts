import {
  ElasticsearchRequestError,
  ElasticsearchUnavailableError,
} from "@/configuration/resources/elasticsearch";
import { PostingsSearchIndexService } from "@/features/postings/search/index.service";

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    requestJson: jest.fn(async () => undefined),
    isEnabled: () => true,
    getPostingsIndexName: () => "postings-test",
    getCircuitBreakerState: jest.fn(),
    ...overrides,
  };
}

function createDocument() {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Toronto Loft",
    description: "A bright production loft",
    tags: ["studio", "Toronto"],
    availabilityStatus: "available",
    searchableAttributes: {
      capacity: 12,
      city: "Toronto",
    },
    pricing: {
      daily: {
        amount: 250,
        currency: "CAD",
      },
    },
    pricingCurrency: "CAD",
    location: {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5V 0A1",
      latitude: 43.64,
      longitude: -79.39,
    },
    photos: [
      {
        blobUrl: "https://cdn.example.test/photo-2.jpg",
        position: 2,
      },
      {
        blobUrl: "https://cdn.example.test/photo-0.jpg",
        position: 0,
      },
    ],
    blockedRanges: [
      {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-02T00:00:00.000Z",
        source: "booking",
      },
    ],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    publishedAt: "2026-05-03T00:00:00.000Z",
  };
}

describe("PostingsSearchIndexService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does nothing when Elasticsearch is disabled", async () => {
    const requestJson = jest.fn(async () => undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
        isEnabled: () => false,
      }) as never,
    );

    await expect(service.ensureLiveIndex()).resolves.toBeUndefined();
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("creates the first concrete index and aliases when both aliases are missing", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await service.ensureLiveIndex();

    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "/postings-test_v1700000000000",
      expect.objectContaining({
        method: "PUT",
      }),
    );

    const createBody = JSON.parse(
      requestJson.mock.calls[2]?.[1]?.body as string,
    ) as {
      mappings: {
        properties: {
          tags: {
            fields: Record<string, unknown>;
          };
        };
      };
    };

    expect(createBody.mappings.properties.tags.fields).toEqual(
      expect.objectContaining({
        prefix: {
          type: "text",
          analyzer: "autocomplete_index",
          search_analyzer: "autocomplete_search",
        },
      }),
    );

    const aliasBody = JSON.parse(
      requestJson.mock.calls[3]?.[1]?.body as string,
    ) as {
      actions: Array<Record<string, unknown>>;
    };

    expect(aliasBody.actions).toEqual([
      {
        add: {
          index: "postings-test_v1700000000000",
          alias: "postings-test-read",
        },
      },
      {
        add: {
          index: "postings-test_v1700000000000",
          alias: "postings-test-write",
          is_write_index: true,
        },
      },
    ]);
  });

  it("repairs a missing read alias by attaching it to the write target", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        "postings-test_v2": {},
      })
      .mockResolvedValueOnce(undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await service.ensureLiveIndex();

    expect(requestJson).toHaveBeenLastCalledWith(
      "/_aliases",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          actions: [
            {
              add: {
                index: "postings-test_v2",
                alias: "postings-test-read",
              },
            },
          ],
        }),
      }),
    );
  });

  it("repairs a missing write alias by attaching it to the read target as writable", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({
        "postings-test_v2": {},
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await service.ensureLiveIndex();

    expect(requestJson).toHaveBeenLastCalledWith(
      "/_aliases",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          actions: [
            {
              add: {
                index: "postings-test_v2",
                alias: "postings-test-write",
                is_write_index: true,
              },
            },
          ],
        }),
      }),
    );
  });

  it("throws when alias state is inconsistent", async () => {
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson: jest
          .fn()
          .mockResolvedValueOnce({
            "postings-test_v1": {},
            "postings-test_v2": {},
          })
          .mockResolvedValueOnce({
            "postings-test_v2": {},
          }),
      }) as never,
    );

    await expect(service.ensureLiveIndex()).rejects.toBeInstanceOf(
      ElasticsearchUnavailableError,
    );
  });

  it("swaps aliases onto the new index and returns the previous targets", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({
        "postings-test_v1": {},
      })
      .mockResolvedValueOnce({
        "postings-test_v1": {},
        "postings-test_v0": {},
      })
      .mockResolvedValueOnce(undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await expect(service.swapAliases("postings-test_v2")).resolves.toEqual({
      previousReadTargets: ["postings-test_v1"],
      previousWriteTargets: ["postings-test_v1", "postings-test_v0"],
    });

    const aliasBody = JSON.parse(
      requestJson.mock.calls[2]?.[1]?.body as string,
    ) as {
      actions: Array<Record<string, unknown>>;
    };

    expect(aliasBody.actions).toEqual([
      {
        remove: {
          index: "postings-test_v1",
          alias: "postings-test-read",
        },
      },
      {
        remove: {
          index: "postings-test_v1",
          alias: "postings-test-write",
        },
      },
      {
        remove: {
          index: "postings-test_v0",
          alias: "postings-test-write",
        },
      },
      {
        add: {
          index: "postings-test_v2",
          alias: "postings-test-read",
        },
      },
      {
        add: {
          index: "postings-test_v2",
          alias: "postings-test-write",
          is_write_index: true,
        },
      },
    ]);
  });

  it("maps posting documents into Elasticsearch bodies for explicit-target upserts", async () => {
    const requestJson = jest.fn(async () => undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await service.upsertDocument(createDocument() as never, "custom-index");

    expect(requestJson).toHaveBeenCalledWith(
      "/custom-index/_doc/posting-1",
      expect.objectContaining({
        method: "PUT",
      }),
    );

    const body = JSON.parse(requestJson.mock.calls[0]?.[1]?.body as string) as {
      primaryPhotoUrl: string;
      photoUrls: string[];
      geoPoint: {
        lat: number;
        lon: number;
      };
      family: string;
      subtype: string;
      dailyPriceAmount: number;
    };

    expect(body).toMatchObject({
      primaryPhotoUrl: "https://cdn.example.test/photo-0.jpg",
      photoUrls: [
        "https://cdn.example.test/photo-2.jpg",
        "https://cdn.example.test/photo-0.jpg",
      ],
      geoPoint: {
        lat: 43.64,
        lon: -79.39,
      },
      family: "place",
      subtype: "workspace",
      dailyPriceAmount: 250,
    });
  });

  it("ensures a live index before deleting through the write alias", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({
        "postings-test_v2": {},
      })
      .mockResolvedValueOnce({
        "postings-test_v2": {},
      })
      .mockResolvedValueOnce(undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await service.deleteDocument("posting-1");

    expect(requestJson).toHaveBeenLastCalledWith(
      "/postings-test-write/_doc/posting-1",
      expect.objectContaining({
        method: "DELETE",
      }),
      {
        allowNotFound: true,
      },
    );
  });

  it("skips Elasticsearch requests for empty bulk operations", async () => {
    const requestJson = jest.fn(async () => undefined);
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await service.bulkUpsertDocuments([], "postings-test_v2");
    await service.bulkDeleteDocuments([], "postings-test_v2");

    expect(requestJson).not.toHaveBeenCalled();
  });

  it("throws request errors for failed bulk upserts", async () => {
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson: jest.fn(async () => ({
          errors: true,
          items: [
            {
              index: {
                status: 400,
                error: {
                  type: "mapper_parsing_exception",
                  reason: "bad document",
                },
              },
            },
          ],
        })),
      }) as never,
    );

    await expect(
      service.bulkUpsertDocuments([createDocument() as never], "postings-test_v2"),
    ).rejects.toBeInstanceOf(ElasticsearchRequestError);
  });

  it("ignores 404 bulk delete misses but surfaces server-side failures", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({
        errors: true,
        items: [
          {
            delete: {
              status: 404,
              error: {
                type: "document_missing_exception",
                reason: "missing",
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        errors: true,
        items: [
          {
            delete: {
              status: 503,
              error: {
                type: "unavailable_shards_exception",
                reason: "cluster unavailable",
              },
            },
          },
        ],
      });
    const service = new PostingsSearchIndexService(
      createClient({
        requestJson,
      }) as never,
    );

    await expect(
      service.bulkDeleteDocuments(["posting-1"], "postings-test_v2"),
    ).resolves.toBeUndefined();
    await expect(
      service.bulkDeleteDocuments(["posting-2"], "postings-test_v2"),
    ).rejects.toBeInstanceOf(ElasticsearchUnavailableError);
  });
});
