import { OrganizationBlogPublicSearchService } from "@/features/organizations/blog-search/public-search.service";
import { ElasticsearchCircuitOpenError } from "@/configuration/resources/elasticsearch";

function createPublishedPost(id: string) {
  return {
    id,
    organizationId: `org-${id}`,
    organization: { id: `org-${id}`, name: `Org ${id}` },
    title: `Post ${id}`,
    slug: `post-${id}`,
    body: "<p>Body</p>",
    tags: ["news"],
    status: "published" as const,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}

function createHarness(options?: {
  enabled?: boolean;
  requestJson?: jest.Mock;
  batchFindPublishedByIds?: jest.Mock;
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
  const batchFindPublishedByIds =
    options?.batchFindPublishedByIds ??
    jest.fn(async (ids: string[]) => ids.map(createPublishedPost));
  const searchPublicFallback =
    options?.searchPublicFallback ??
    jest.fn(async () => ({ ids: ["db-1", "db-2"], total: 2 }));

  const repository = {
    batchFindPublishedByIds,
    searchPublicFallback,
  };
  const indexService = {
    getReadAliasName: () => "organization-blogs-read",
  };
  const elasticsearch = {
    isEnabled: () => options?.enabled ?? true,
    requestJson,
  };

  const service = new OrganizationBlogPublicSearchService(
    repository as any,
    indexService as any,
    elasticsearch as any,
  );

  return {
    service,
    requestJson,
    batchFindPublishedByIds,
    searchPublicFallback,
  };
}

describe("OrganizationBlogPublicSearchService", () => {
  it("serves global results from Elasticsearch and hydrates rows from the database", async () => {
    const {
      service,
      requestJson,
      batchFindPublishedByIds,
      searchPublicFallback,
    } = createHarness();

    const result = await service.searchGlobal({
      page: 1,
      pageSize: 20,
      q: "weekend",
    });

    expect(result.source).toBe("elasticsearch");
    expect(result.query).toBe("weekend");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.id).toBe("es-1");
    expect(result.pagination.total).toBe(1);
    expect(batchFindPublishedByIds).toHaveBeenCalledWith(["es-1"]);
    expect(searchPublicFallback).not.toHaveBeenCalled();

    const [path, init] = requestJson.mock.calls[0]!;
    expect(path).toBe("/organization-blogs-read/_search");
    const body = JSON.parse((init as { body: string }).body);
    expect(JSON.stringify(body)).toContain("weekend");
    // Global search always filters to published posts.
    expect(JSON.stringify(body.query.bool.filter)).toContain("published");
    expect(body.size).toBe(20);
  });

  it("scopes a per-organization search with an organizationId filter", async () => {
    const { service, requestJson } = createHarness();

    await service.searchByOrganization({
      organizationId: "org-42",
      page: 1,
      pageSize: 20,
    });

    const body = JSON.parse(
      (requestJson.mock.calls[0]![1] as { body: string }).body,
    );
    expect(JSON.stringify(body.query.bool.filter)).toContain("org-42");
    expect(JSON.stringify(body.query.bool.filter)).toContain("published");
  });

  it("retries with a tolerant query when a strict search returns no hits", async () => {
    const requestJson = jest
      .fn()
      .mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } })
      .mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _id: "es-7" }] },
      });
    const { service } = createHarness({ requestJson });

    const result = await service.searchGlobal({
      page: 1,
      pageSize: 20,
      q: "wekend",
    });

    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("elasticsearch");
    expect(result.posts[0]?.id).toBe("es-7");
  });

  it("falls back to the database when Elasticsearch is disabled", async () => {
    const { service, requestJson, searchPublicFallback } = createHarness({
      enabled: false,
    });

    const result = await service.searchGlobal({ page: 1, pageSize: 20 });

    expect(requestJson).not.toHaveBeenCalled();
    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
    expect(result.posts.map((post) => post.id)).toEqual(["db-1", "db-2"]);
    expect(result.pagination.total).toBe(2);
  });

  it("falls back to the database when the circuit breaker is open", async () => {
    const requestJson = jest.fn(async () => {
      throw new ElasticsearchCircuitOpenError(new Date());
    });
    const { service, searchPublicFallback } = createHarness({ requestJson });

    const result = await service.searchGlobal({
      page: 1,
      pageSize: 20,
      q: "office",
    });

    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
  });

  it("falls back to the database on a generic Elasticsearch error", async () => {
    const requestJson = jest.fn(async () => {
      throw new Error("connection reset");
    });
    const { service, searchPublicFallback } = createHarness({ requestJson });

    const result = await service.searchByOrganization({
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
      q: "depot",
    });

    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
    // The fallback is scoped to the organization.
    expect(searchPublicFallback.mock.calls[0]![0].organizationId).toBe("org-1");
  });

  it.each([["relevance"], ["newest"], ["oldest"]] as const)(
    "builds a sort clause for %s",
    async (sort) => {
      const { service, requestJson } = createHarness();

      await service.searchGlobal({ page: 2, pageSize: 10, sort });

      const body = JSON.parse(
        (requestJson.mock.calls[0]![1] as { body: string }).body,
      );
      expect(Array.isArray(body.sort)).toBe(true);
      expect(body.from).toBe(10);
    },
  );

  it("clamps an out-of-range page to the result window instead of erroring", async () => {
    // page 600 * pageSize 20 => from 11980, beyond the 10k window. The request
    // must stay within from + size <= 10000 (so ES returns no 400), report the
    // real total, and NOT record a database fallback.
    const requestJson = jest.fn(async (_path: string, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body) as {
        from: number;
        size: number;
      };
      expect(body.from).toBeLessThanOrEqual(10_000);
      expect(body.from + body.size).toBeLessThanOrEqual(10_000);
      return { hits: { total: { value: 42 }, hits: [] } };
    });
    const { service, searchPublicFallback } = createHarness({ requestJson });

    const result = await service.searchGlobal({ page: 600, pageSize: 20 });

    expect(result.source).toBe("elasticsearch");
    expect(result.posts).toEqual([]);
    expect(result.pagination.total).toBe(42);
    expect(searchPublicFallback).not.toHaveBeenCalled();
  });

  it("caps the navigable page count to the search result window", async () => {
    const requestJson = jest.fn(async () => ({
      hits: { total: { value: 1_000_000 }, hits: [{ _id: "es-1" }] },
    }));
    const { service } = createHarness({ requestJson });

    const result = await service.searchGlobal({ page: 1, pageSize: 20 });

    expect(result.pagination.total).toBe(1_000_000);
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
    const batchFindPublishedByIds = jest
      .fn()
      .mockResolvedValueOnce([createPublishedPost("es-1")])
      .mockResolvedValueOnce([createPublishedPost("db-1")]);
    const searchPublicFallback = jest.fn(async () => ({
      ids: ["db-1"],
      total: 1,
    }));
    const { service } = createHarness({
      requestJson,
      batchFindPublishedByIds,
      searchPublicFallback,
    });

    const result = await service.searchGlobal({
      page: 1,
      pageSize: 20,
      q: "warehouse",
    });

    expect(searchPublicFallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("database");
    expect(result.posts.map((post) => post.id)).toEqual(["db-1"]);
  });
});
