import { OrganizationsPublicSearchService } from "@/features/organizations/search/public-search.service";
import { ElasticsearchCircuitOpenError } from "@/configuration/resources/elasticsearch";

function createPublicOrganization(id: string) {
  return {
    id,
    name: `Organization ${id}`,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    publishedPostingCount: 3,
    description: null,
    websiteUrl: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    country: null,
    postalCode: null,
    logoUrl: null,
    customFields: null,
  };
}

function createHarness(options?: {
  enabled?: boolean;
  requestJson?: jest.Mock;
  batchFindPublicByIds?: jest.Mock;
  searchPublicFallback?: jest.Mock;
}) {
  const requestJson =
    options?.requestJson ??
    jest.fn(async () => ({
      hits: {
        total: { value: 1 },
        hits: [{ _id: "es-1" }],
      },
    }));
  const batchFindPublicByIds =
    options?.batchFindPublicByIds ??
    jest.fn(async (ids: string[]) => ids.map(createPublicOrganization));
  const searchPublicFallback =
    options?.searchPublicFallback ??
    jest.fn(async () => ({ ids: ["db-1", "db-2"], total: 2 }));

  const repository = {
    batchFindPublicByIds,
    searchPublicFallback,
  };
  const indexService = {
    getReadAliasName: () => "organizations-read",
  };
  const elasticsearch = {
    isEnabled: () => options?.enabled ?? true,
    requestJson,
  };

  const service = new OrganizationsPublicSearchService(
    repository as never,
    indexService as never,
    elasticsearch as never,
  );

  return {
    service,
    requestJson,
    batchFindPublicByIds,
    searchPublicFallback,
  };
}

describe("OrganizationsPublicSearchService", () => {
  it("serves results from Elasticsearch and hydrates rows from the database", async () => {
    const { service, requestJson, batchFindPublicByIds, searchPublicFallback } =
      createHarness();

    const result = await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "amsterdam",
    });

    expect(result.source).toBe("elasticsearch");
    expect(result.query).toBe("amsterdam");
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]?.id).toBe("es-1");
    expect(result.pagination.total).toBe(1);
    expect(batchFindPublicByIds).toHaveBeenCalledWith(["es-1"]);
    expect(searchPublicFallback).not.toHaveBeenCalled();

    const [path, init] = requestJson.mock.calls[0]!;
    expect(path).toBe("/organizations-read/_search");
    const body = JSON.parse((init as { body: string }).body);
    expect(JSON.stringify(body)).toContain("amsterdam");
    expect(body.size).toBe(20);
  });

  it("retries with a tolerant query when a strict search returns no hits", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } })
      .mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _id: "es-7" }] },
      });
    const { service } = createHarness({ requestJson });

    const result = await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "amstrdam",
    });

    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("elasticsearch");
    expect(result.organizations[0]?.id).toBe("es-7");
  });

  it("falls back to the database when Elasticsearch is disabled", async () => {
    const { service, requestJson, searchPublicFallback } = createHarness({
      enabled: false,
    });

    const result = await service.searchPublic({
      page: 1,
      pageSize: 20,
    });

    expect(requestJson).not.toHaveBeenCalled();
    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
    expect(result.organizations.map((org) => org.id)).toEqual(["db-1", "db-2"]);
    expect(result.pagination.total).toBe(2);
  });

  it("falls back to the database when the circuit breaker is open", async () => {
    const requestJson = jest.fn(async () => {
      throw new ElasticsearchCircuitOpenError(new Date());
    });
    const { service, searchPublicFallback } = createHarness({ requestJson });

    const result = await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "office",
    });

    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
  });

  it("falls back to the database on a generic Elasticsearch error", async () => {
    const requestJson = jest.fn(async () => {
      throw new Error("connection reset");
    });
    const { service, searchPublicFallback } = createHarness({ requestJson });

    const result = await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "depot",
    });

    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
  });

  it.each([
    ["relevance"],
    ["nameAsc"],
    ["nameDesc"],
    ["newest"],
    ["oldest"],
  ] as const)("builds a sort clause for %s", async (sort) => {
    const { service, requestJson } = createHarness();

    await service.searchPublic({ page: 2, pageSize: 10, sort });

    const body = JSON.parse(
      (requestJson.mock.calls[0]![1] as { body: string }).body,
    );
    expect(Array.isArray(body.sort)).toBe(true);
    expect(body.from).toBe(10);
  });

  it("caps the navigable page count to the search result window", async () => {
    const requestJson = jest.fn(async () => ({
      hits: { total: { value: 1_000_000 }, hits: [{ _id: "es-1" }] },
    }));
    const { service } = createHarness({ requestJson });

    const result = await service.searchPublic({ page: 1, pageSize: 20 });

    expect(result.pagination.total).toBe(1_000_000);
    // The navigable window is bounded (10k / 20 = 500 pages) even though the
    // reported total is far larger.
    expect(result.pagination.totalPages).toBe(500);
    expect(result.pagination.hasNextPage).toBe(true);
  });

  it("re-runs against the database when Elasticsearch returns stale ids", async () => {
    const requestJson = jest.fn(async () => ({
      hits: {
        total: { value: 2 },
        hits: [{ _id: "es-1" }, { _id: "stale-2" }],
      },
    }));
    // First hydration (from ES ids) drops the stale id; the DB fallback then
    // supplies the authoritative rows.
    const batchFindPublicByIds = jest
      .fn()
      .mockResolvedValueOnce([createPublicOrganization("es-1")])
      .mockResolvedValueOnce([createPublicOrganization("db-1")]);
    const searchPublicFallback = jest.fn(async () => ({
      ids: ["db-1"],
      total: 1,
    }));
    const { service } = createHarness({
      requestJson,
      batchFindPublicByIds,
      searchPublicFallback,
    });

    const result = await service.searchPublic({
      page: 1,
      pageSize: 20,
      query: "warehouse",
    });

    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
    expect(result.organizations.map((org) => org.id)).toEqual(["db-1"]);
  });
});
