const mockGetOptionalEnvironmentVariable = jest.fn();

jest.mock("@/configuration/environment", () => {
  const actual = jest.requireActual("@/configuration/environment");

  return {
    ...actual,
    getOptionalEnvironmentVariable: (name: string) =>
      mockGetOptionalEnvironmentVariable(name),
  };
});

import {
  ElasticsearchRequestError,
  ElasticsearchUnavailableError,
} from "@/configuration/resources/elasticsearch";
import { ReportsSearchIndexService } from "@/features/reports/search/index.service";
import type {
  ContentReportSearchDocument,
  ListContentReportsInput,
} from "@/features/reports/reports.model";

describe("ReportsSearchIndexService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockGetOptionalEnvironmentVariable.mockReset();
  });

  it("does nothing when ensuring the index while Elasticsearch is disabled", async () => {
    const requestJson: any = jest.fn(async (): Promise<any> => undefined);
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        isEnabled: () => false,
        requestJson,
      }) as any,
    );

    await service.ensureIndex();

    expect(service.isElasticsearchEnabled()).toBe(false);
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("swallows index creation conflicts from Elasticsearch", async () => {
    const requestJson = jest.fn(async () => {
      throw new ElasticsearchRequestError(400, "resource_already_exists");
    });
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await expect(service.ensureIndex()).resolves.toBeUndefined();
    expect(requestJson).toHaveBeenCalledWith(
      "/postings-test-reports",
      expect.objectContaining({
        method: "PUT",
      }),
      {
        allowNotFound: true,
      },
    );
  });

  it("indexes documents using the configured reports index name override", async () => {
    mockGetOptionalEnvironmentVariable.mockImplementation((name: string) =>
      name === "ELASTICSEARCH_REPORTS_INDEX"
        ? "custom-reports-index"
        : undefined,
    );
    const requestJson: any = jest
      .fn(async (): Promise<any> => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await service.upsertDocument(createDocument());

    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      "/custom-reports-index",
      expect.objectContaining({
        method: "PUT",
      }),
      {
        allowNotFound: true,
      },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/custom-reports-index/_doc/report-1",
      {
        method: "PUT",
        body: JSON.stringify(createDocument()),
      },
    );
  });

  it("deletes indexed documents with allowNotFound enabled", async () => {
    const requestJson: any = jest.fn(async (): Promise<any> => undefined);
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await service.deleteDocument("report-1");

    expect(requestJson).toHaveBeenCalledWith(
      "/postings-test-reports/_doc/report-1",
      {
        method: "DELETE",
      },
      {
        allowNotFound: true,
      },
    );
  });

  it("skips bulk indexing when there are no documents", async () => {
    const requestJson: any = jest.fn(async (): Promise<any> => undefined);
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await service.bulkUpsertDocuments([]);

    expect(requestJson).not.toHaveBeenCalled();
  });

  it("bulk indexes reports as ndjson payloads", async () => {
    const requestJson: any = jest
      .fn(async (): Promise<any> => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        errors: false,
      });
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await service.bulkUpsertDocuments([createDocument()]);

    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/_bulk",
      expect.objectContaining({
        method: "POST",
        body:
          '{"index":{"_index":"postings-test-reports","_id":"report-1"}}\n' +
          `${JSON.stringify(createDocument())}\n`,
      }),
      {
        contentType: "application/x-ndjson",
      },
    );
  });

  it("classifies bulk client failures as request errors", async () => {
    const requestJson: any = jest
      .fn(async (): Promise<any> => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        errors: true,
        items: [
          {
            index: {
              status: 409,
              error: {
                type: "version_conflict_engine_exception",
                reason: "conflict",
              },
            },
          },
        ],
      });
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await expect(
      service.bulkUpsertDocuments([createDocument()]),
    ).rejects.toMatchObject({
      name: "ElasticsearchRequestError",
      status: 409,
    });
  });

  it("classifies bulk server failures as unavailable errors", async () => {
    const requestJson: any = jest
      .fn(async (): Promise<any> => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        errors: true,
        items: [
          {
            index: {
              status: 503,
              error: {
                type: "unavailable_shards_exception",
                reason: "cluster unavailable",
              },
            },
          },
        ],
      });
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    await expect(
      service.bulkUpsertDocuments([createDocument()]),
    ).rejects.toBeInstanceOf(ElasticsearchUnavailableError);
  });

  it("builds a filtered multi-match search request and returns ids with totals", async () => {
    const requestJson: any = jest
      .fn(async (): Promise<any> => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        hits: {
          total: {
            value: 2,
          },
          hits: [{ _id: "report-1" }, { _id: "report-2" }],
        },
      });
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    const result = await service.search({
      ...createSearchInput(),
      query: "spam listing",
      status: "open",
      subjectType: "posting",
      reasonCode: "spam",
      assignedTo: "unassigned",
      reporterId: "user-1",
      sort: "recentlyReviewed",
      page: 2,
      pageSize: 10,
    });

    expect(result).toEqual({
      ids: ["report-1", "report-2"],
      total: 2,
    });

    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/postings-test-reports/_search",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const body = JSON.parse(
      (requestJson.mock.calls[1] as any)?.[1]?.body as string,
    ) as Record<string, unknown>;

    expect(body).toMatchObject({
      from: 10,
      size: 10,
      sort: [
        { reviewedAt: { order: "desc", missing: "_last" } },
        { createdAt: { order: "desc" } },
      ],
    });

    expect(body.query).toEqual({
      bool: {
        filter: [
          {
            term: {
              status: "open",
            },
          },
          {
            term: {
              subjectType: "posting",
            },
          },
          {
            term: {
              reasonCode: "spam",
            },
          },
          {
            bool: {
              must_not: {
                exists: {
                  field: "assignedModeratorId",
                },
              },
            },
          },
          {
            term: {
              reporterId: "user-1",
            },
          },
        ],
        must: [
          {
            multi_match: {
              query: "spam listing",
              fields: [
                "title^5",
                "description^3",
                "subjectSnapshotText^2",
                "reporterUsername^2",
                "reporterEmail",
                "assignedModeratorUsername",
                "assignedModeratorEmail",
              ],
            },
          },
        ],
      },
    });
  });

  it("uses match_all queries and oldest sorting when no search text is provided", async () => {
    const requestJson: any = jest
      .fn(async (): Promise<any> => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        hits: {},
      });
    const service = new ReportsSearchIndexService(
      createElasticsearchClient({
        requestJson,
      }) as any,
    );

    const result = await service.search({
      ...createSearchInput(),
      sort: "oldest",
      assignedTo: "moderator-1",
    });

    expect(result).toEqual({
      ids: [],
      total: 0,
    });

    const body = JSON.parse(
      (requestJson.mock.calls[1] as any)?.[1]?.body as string,
    ) as Record<string, unknown>;

    expect(body).toMatchObject({
      from: 0,
      size: 20,
      sort: [{ createdAt: { order: "asc" } }],
      query: {
        bool: {
          filter: [
            {
              term: {
                assignedModeratorId: "moderator-1",
              },
            },
          ],
        },
      },
    });
  });
});

function createElasticsearchClient(
  overrides: Partial<{
    getPostingsIndexName: () => string;
    isEnabled: () => boolean;
    requestJson: (...args: unknown[]) => Promise<unknown>;
  }> = {},
) {
  return {
    getPostingsIndexName: () => "postings-test",
    isEnabled: () => true,
    requestJson: jest.fn(async () => undefined),
    ...overrides,
  };
}

function createDocument(
  overrides: Partial<ContentReportSearchDocument> = {},
): ContentReportSearchDocument {
  return {
    id: "report-1",
    subjectType: "posting",
    subjectId: "posting-1",
    reasonCode: "spam",
    status: "open",
    title: "Suspicious report",
    description: "This listing asks for money off platform.",
    subjectSnapshotText: "Snapshot text",
    reporterId: "user-1",
    reporterEmail: "reporter@example.com",
    reporterUsername: "reporter-one",
    reporterRole: "user",
    assignedModeratorId: "moderator-1",
    assignedModeratorEmail: "moderator@example.com",
    assignedModeratorUsername: "moderator-one",
    assignedModeratorRole: "moderator",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    reviewedAt: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}

function createSearchInput(
  overrides: Partial<ListContentReportsInput> = {},
): ListContentReportsInput {
  return {
    page: 1,
    pageSize: 20,
    query: undefined,
    status: undefined,
    subjectType: undefined,
    reasonCode: undefined,
    assignedTo: undefined,
    reporterId: undefined,
    sort: "newest",
    ...overrides,
  };
}
