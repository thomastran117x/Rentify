import { OrganizationsSearchIndexService } from "@/features/organizations/search/index.service";
import {
  ElasticsearchRequestError,
  ElasticsearchUnavailableError,
} from "@/configuration/resources/elasticsearch";

type RequestHandler = (
  path: string,
  init: { method?: string; body?: string },
) => unknown;

function createEsClient(options?: {
  enabled?: boolean;
  handler?: RequestHandler;
}) {
  const requestJson = jest.fn(
    async (path: string, init: { method?: string; body?: string }) =>
      options?.handler ? options.handler(path, init) : {},
  );
  const client = {
    isEnabled: () => options?.enabled ?? true,
    getPostingsIndexName: () => "postings",
    getCircuitBreakerState: () => ({
      state: "closed" as const,
      consecutiveFailures: 0,
      failureThreshold: 3,
      cooldownMs: 30_000,
    }),
    requestJson,
  };
  return { client, requestJson };
}

function createDocument(id: string) {
  return {
    id,
    name: `Org ${id}`,
    description: "desc",
    city: "Berlin",
    region: "BE",
    country: "DE",
    postalCode: "10115",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}

describe("OrganizationsSearchIndexService", () => {
  it("derives read/write aliases from the base index name", () => {
    const { client } = createEsClient();
    const service = new OrganizationsSearchIndexService(client as never);

    expect(service.getBaseIndexName()).toBe("postings-organizations");
    expect(service.getReadAliasName()).toBe("postings-organizations-read");
    expect(service.getWriteAliasName()).toBe("postings-organizations-write");
    expect(service.isElasticsearchEnabled()).toBe(true);
    expect(service.getCircuitBreakerState().state).toBe("closed");
  });

  it("is a no-op for ensureLiveIndex when Elasticsearch is disabled", async () => {
    const { client, requestJson } = createEsClient({ enabled: false });
    const service = new OrganizationsSearchIndexService(client as never);

    await service.ensureLiveIndex();

    expect(requestJson).not.toHaveBeenCalled();
    const status = await service.getAliasStatus();
    expect(status.state).toBe("disabled");
  });

  it("creates a concrete index and wires aliases when none exist", async () => {
    const handler: RequestHandler = (path, init) => {
      if (path.startsWith("/_alias/")) {
        return {}; // no alias targets yet -> "missing"
      }
      return {};
      void init;
    };
    const { client, requestJson } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    await service.ensureLiveIndex();

    const putIndex = requestJson.mock.calls.find(
      ([path, init]) =>
        (init as { method?: string }).method === "PUT" &&
        !String(path).startsWith("/_alias/"),
    );
    const aliasWrite = requestJson.mock.calls.find(
      ([path]) => path === "/_aliases",
    );
    expect(putIndex).toBeDefined();
    expect(aliasWrite).toBeDefined();
    const aliasBody = JSON.parse(
      (aliasWrite![1] as { body: string }).body,
    ) as { actions: Array<Record<string, unknown>> };
    expect(aliasBody.actions.some((action) => "add" in action)).toBe(true);
  });

  it("reports a ready alias status when both aliases share one index", async () => {
    const handler: RequestHandler = (path) => {
      if (path.includes("-read") || path.includes("-write")) {
        return { "postings-organizations_v1": {} };
      }
      return {};
    };
    const { client } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    const status = await service.getAliasStatus();

    expect(status.state).toBe("ready");
    expect(status.readTargets).toEqual(["postings-organizations_v1"]);
  });

  it("detects an inconsistent alias configuration", async () => {
    const handler: RequestHandler = (path) => {
      if (path.includes("-read")) {
        return { "idx-a": {}, "idx-b": {} };
      }
      if (path.includes("-write")) {
        return { "idx-c": {} };
      }
      return {};
    };
    const { client } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    const status = await service.getAliasStatus();
    expect(status.state).toBe("inconsistent");
    await expect(service.ensureLiveIndex()).rejects.toBeInstanceOf(
      ElasticsearchUnavailableError,
    );
  });

  it("repairs a missing read alias", async () => {
    const handler: RequestHandler = (path) => {
      if (path.includes("-read")) {
        return {}; // read alias missing
      }
      if (path.includes("-write")) {
        return { "postings-organizations_v1": {} };
      }
      return {};
    };
    const { client, requestJson } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    await service.ensureLiveIndex();

    const aliasCall = requestJson.mock.calls.find(
      ([path]) => path === "/_aliases",
    );
    expect(aliasCall).toBeDefined();
    const body = JSON.parse((aliasCall![1] as { body: string }).body) as {
      actions: Array<Record<string, { alias: string }>>;
    };
    expect(
      body.actions.some(
        (action) => action.add?.alias === "postings-organizations-read",
      ),
    ).toBe(true);
  });

  it("repairs a missing write alias", async () => {
    const handler: RequestHandler = (path) => {
      if (path.includes("-read")) {
        return { "postings-organizations_v1": {} };
      }
      if (path.includes("-write")) {
        return {}; // write alias missing
      }
      return {};
    };
    const { client, requestJson } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    await service.ensureLiveIndex();

    const aliasCall = requestJson.mock.calls.find(
      ([path]) => path === "/_aliases",
    );
    const body = JSON.parse((aliasCall![1] as { body: string }).body) as {
      actions: Array<Record<string, { alias: string; is_write_index?: boolean }>>;
    };
    expect(
      body.actions.some(
        (action) => action.add?.alias === "postings-organizations-write",
      ),
    ).toBe(true);
  });

  it("bulk deletes documents and ignores 404s while surfacing real errors", async () => {
    const okHandler: RequestHandler = () => ({
      errors: true,
      items: [{ delete: { status: 404 } }],
    });
    const { client, requestJson } = createEsClient({ handler: okHandler });
    const service = new OrganizationsSearchIndexService(client as never);

    // 404 on delete is treated as success (already gone).
    await service.bulkDeleteDocuments(["a", "b"], "idx");
    expect(requestJson).toHaveBeenCalled();

    const failHandler: RequestHandler = () => ({
      errors: true,
      items: [{ delete: { status: 500, error: { type: "x", reason: "y" } } }],
    });
    const failing = new OrganizationsSearchIndexService(
      createEsClient({ handler: failHandler }).client as never,
    );
    await expect(
      failing.bulkDeleteDocuments(["a"], "idx"),
    ).rejects.toBeInstanceOf(ElasticsearchUnavailableError);
  });

  it("upserts and deletes a single document against the write alias", async () => {
    const handler: RequestHandler = (path) => {
      if (path.startsWith("/_alias/")) {
        return { "postings-organizations_v1": {} };
      }
      return {};
    };
    const { client, requestJson } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    await service.upsertDocument(createDocument("org-1"));
    await service.deleteDocument("org-1");

    const put = requestJson.mock.calls.find(
      ([path, init]) =>
        String(path).includes("/_doc/org-1") &&
        (init as { method?: string }).method === "PUT",
    );
    const del = requestJson.mock.calls.find(
      ([path, init]) =>
        String(path).includes("/_doc/org-1") &&
        (init as { method?: string }).method === "DELETE",
    );
    expect(put).toBeDefined();
    expect(del).toBeDefined();
    const body = JSON.parse((put![1] as { body: string }).body);
    expect(body.location.city).toBe("Berlin");
    expect(body.name).toBe("Org org-1");
  });

  it("bulk upserts documents and surfaces bulk errors", async () => {
    const okHandler: RequestHandler = () => ({ errors: false });
    const { client, requestJson } = createEsClient({ handler: okHandler });
    const service = new OrganizationsSearchIndexService(client as never);

    await service.bulkUpsertDocuments(
      [createDocument("a"), createDocument("b")],
      "postings-organizations_v1",
    );
    const bulkCall = requestJson.mock.calls.find(([path]) => path === "/_bulk");
    expect(bulkCall).toBeDefined();
    expect((bulkCall![1] as { body: string }).body).toContain("Org a");

    const failHandler: RequestHandler = () => ({
      errors: true,
      items: [{ index: { status: 400, error: { type: "mapper", reason: "x" } } }],
    });
    const failing = new OrganizationsSearchIndexService(
      createEsClient({ handler: failHandler }).client as never,
    );
    await expect(
      failing.bulkUpsertDocuments([createDocument("a")], "idx"),
    ).rejects.toBeInstanceOf(ElasticsearchRequestError);
  });

  it("ignores empty bulk operations", async () => {
    const { client, requestJson } = createEsClient();
    const service = new OrganizationsSearchIndexService(client as never);

    await service.bulkUpsertDocuments([], "idx");
    await service.bulkDeleteDocuments([], "idx");

    expect(requestJson).not.toHaveBeenCalled();
  });

  it("swaps aliases from the previous targets to a new index", async () => {
    const handler: RequestHandler = (path) => {
      if (path.startsWith("/_alias/")) {
        return { "postings-organizations_v1": {} };
      }
      return {};
    };
    const { client, requestJson } = createEsClient({ handler });
    const service = new OrganizationsSearchIndexService(client as never);

    const result = await service.swapAliases("postings-organizations_v2");

    expect(result.previousReadTargets).toEqual(["postings-organizations_v1"]);
    const aliasCall = requestJson.mock.calls.find(
      ([path]) => path === "/_aliases",
    );
    const body = JSON.parse((aliasCall![1] as { body: string }).body) as {
      actions: Array<Record<string, { index: string; alias: string }>>;
    };
    expect(
      body.actions.some(
        (action) => action.add?.index === "postings-organizations_v2",
      ),
    ).toBe(true);
    expect(body.actions.some((action) => "remove" in action)).toBe(true);
  });

  it("creates a versioned index and tolerates an already-existing index", async () => {
    const { client, requestJson } = createEsClient();
    const service = new OrganizationsSearchIndexService(client as never);
    const name = await service.createVersionedIndex("postings-organizations_v9");
    expect(name).toBe("postings-organizations_v9");

    const conflictClient = createEsClient({
      handler: () => {
        throw new ElasticsearchRequestError(
          400,
          "resource_already_exists_exception",
        );
      },
    });
    const conflictService = new OrganizationsSearchIndexService(
      conflictClient.client as never,
    );
    await expect(
      conflictService.createVersionedIndex("postings-organizations_v9"),
    ).resolves.toBe("postings-organizations_v9");

    void requestJson;
  });

  it("deletes a concrete index", async () => {
    const { client, requestJson } = createEsClient();
    const service = new OrganizationsSearchIndexService(client as never);

    await service.deleteConcreteIndex("postings-organizations_v1");

    const del = requestJson.mock.calls.find(
      ([path, init]) =>
        path === "/postings-organizations_v1" &&
        (init as { method?: string }).method === "DELETE",
    );
    expect(del).toBeDefined();
  });
});
