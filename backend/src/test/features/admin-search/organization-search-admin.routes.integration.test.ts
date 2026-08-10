import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { OrganizationBlogSearchController } from "@/features/organizations/blog-search/organization-blog-search.controller";
import { OrganizationsSearchController } from "@/features/organizations/search/organizations-search.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

/**
 * The organization and blog search admin surfaces expose the same five
 * maintenance operations under different prefixes, so they are covered by one
 * parameterised suite.
 *
 * These are route-contract tests rather than persistence tests: the operations
 * drive Elasticsearch index lifecycle work, and the equivalent posting-search
 * admin endpoints are covered the same way.
 */
function createSearchServiceStub() {
  return {
    startReindex: jest.fn(async () => ({
      id: "reindex-1",
      status: "running",
      targetIndexName: "organizations_v4",
      totalPostings: 62,
      indexedPostings: 40,
      failedPostings: 0,
    })),
    getReindexRun: jest.fn(async (id: string) => ({
      run: { id, status: "running" },
    })),
    getStatus: jest.fn(async () => ({
      aliases: { read: "organizations-read", write: "organizations-write" },
    })),
    replayDeadLetteredOutbox: jest.fn(async (_limit?: number) => ({
      revived: 4,
    })),
    cleanupRetainedIndices: jest.fn(async () => ({ deleted: 1 })),
  };
}

function createTokenServiceStub() {
  return {
    verifyAccessToken: jest.fn(async () =>
      createJwtClaims({ sub: "admin-1", role: "admin" }),
    ),
  };
}

/**
 * Declared as a plain function rather than `describe.each` so that each request
 * site's `basePath` resolves statically from the two call sites below.
 */
function describeSearchAdminSuite(
  suiteName: string,
  basePath: string,
  buildController: (
    service: ReturnType<typeof createSearchServiceStub>,
  ) => readonly [unknown, unknown],
) {
  describe(`${suiteName} routes integration`, () => {
    function createApp() {
      const searchService = createSearchServiceStub();
      const [token, controller] = buildController(searchService);

      const registry = new Map<unknown, unknown>([
        [token, controller],
        [containerTokens.tokenService, createTokenServiceStub()],
      ]);

      return { app: createRouteTestApp(registry), searchService };
    }

    function adminHeaders() {
      return {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      };
    }

    it("starts a reindex run", async () => {
      const { app, searchService } = createApp();

      const response = await app.request(
        `http://rent.test${buildApiPath(`${basePath}/reindex`)}`,
        { method: "POST", headers: adminHeaders() },
      );

      expect(response.status).toBe(202);
      expect(searchService.startReindex).toHaveBeenCalled();
    });

    it("reads a reindex run by id", async () => {
      const { app, searchService } = createApp();

      const response = await app.request(
        `http://rent.test${buildApiPath(`${basePath}/reindex-runs/run-1`)}`,
        { headers: adminHeaders() },
      );

      expect(response.status).toBe(200);
      expect(searchService.getReindexRun).toHaveBeenCalledWith("run-1");
    });

    it("reads index status", async () => {
      const { app, searchService } = createApp();

      const response = await app.request(
        `http://rent.test${buildApiPath(`${basePath}/status`)}`,
        { headers: adminHeaders() },
      );

      expect(response.status).toBe(200);
      expect(searchService.getStatus).toHaveBeenCalled();
    });

    it("replays dead-lettered outbox entries with the requested limit", async () => {
      const { app, searchService } = createApp();

      const response = await app.request(
        `http://rent.test${buildApiPath(`${basePath}/outbox/replay-dead-lettered?limit=25`)}`,
        { method: "POST", headers: adminHeaders() },
      );

      expect(response.status).toBe(202);
      expect(searchService.replayDeadLetteredOutbox).toHaveBeenCalledWith(25);
    });

    it("cleans up retained indices", async () => {
      const { app, searchService } = createApp();

      const response = await app.request(
        `http://rent.test${buildApiPath(`${basePath}/cleanup-retained-indices`)}`,
        { method: "POST", headers: adminHeaders() },
      );

      expect(response.status).toBe(202);
      expect(searchService.cleanupRetainedIndices).toHaveBeenCalled();
    });

    it("refuses a non-admin caller", async () => {
      const searchService = createSearchServiceStub();
      const [token, controller] = buildController(searchService);
      const registry = new Map<unknown, unknown>([
        [token, controller],
        [
          containerTokens.tokenService,
          {
            verifyAccessToken: jest.fn(async () =>
              createJwtClaims({ sub: "user-1", role: "user" }),
            ),
          },
        ],
      ]);

      const response = await createRouteTestApp(registry).request(
        `http://rent.test${buildApiPath(`${basePath}/status`)}`,
        { headers: { authorization: "Bearer user-token" } },
      );

      expect(response.status).toBe(403);
      expect(searchService.getStatus).not.toHaveBeenCalled();
    });
  });
}

describeSearchAdminSuite(
  "organization search admin",
  "/admin/organizations/search",
  (service) =>
    [
      containerTokens.organizationsSearchController,
      new OrganizationsSearchController(service as never),
    ] as const,
);

describeSearchAdminSuite(
  "organization blog search admin",
  "/admin/organizations/blog-search",
  (service) =>
    [
      containerTokens.organizationBlogSearchController,
      new OrganizationBlogSearchController(service as never),
    ] as const,
);
