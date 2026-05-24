import { ElasticsearchUnavailableError } from "@/configuration/resources/elasticsearch";
import {
  publicAutocompletePostingsQuerySchema,
  type PostingAutocompleteInput,
} from "@/features/postings/postings.model";
import { PostingsRepository } from "@/features/postings/postings.repository";
import { PostingsPublicAutocompleteService } from "@/features/postings/search/autocomplete.service";
import { PostingsSearchIndexService } from "@/features/postings/search/index.service";

function createElasticsearchAutocompleteService(response: unknown) {
  const autocompletePublicFallback = jest.fn();
  const requestJson = jest.fn(async () => response);
  const repository = {
    autocompletePublicFallback,
  } as unknown as PostingsRepository;
  const service = new PostingsPublicAutocompleteService(repository, {
    getPostingsIndexName: () => "postings-test",
    requestJson,
    isEnabled: () => true,
  } as never);

  return {
    autocompletePublicFallback,
    requestJson,
    service,
  };
}

function readAutocompleteRequestBody(requestJson: jest.Mock): {
  query: {
    bool: {
      filter: unknown[];
    };
  };
} {
  return JSON.parse(requestJson.mock.calls[0]?.[1]?.body as string);
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
    const autocompletePublicFallback = jest.fn(async (input: PostingAutocompleteInput) => [
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
    ]);
    const service = new PostingsPublicAutocompleteService(
      {
        autocompletePublicFallback,
      } as unknown as PostingsRepository,
      {
        getPostingsIndexName: () => "postings-test",
        requestJson: jest.fn(async () => {
          throw new ElasticsearchUnavailableError("Elasticsearch is unavailable.");
        }),
        isEnabled: () => true,
      } as never,
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
});

describe("PostingsSearchIndexService", () => {
  it("adds an autocomplete prefix field for tags", async () => {
    const requestJson = jest.fn(async () => undefined);
    const service = new PostingsSearchIndexService({
      getPostingsIndexName: () => "postings-test",
      requestJson,
      isEnabled: () => true,
    } as never);

    await service.createVersionedIndex();

    const body = JSON.parse(requestJson.mock.calls[0]?.[1]?.body as string) as {
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
