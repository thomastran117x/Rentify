import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { SearchController } from "@/features/search/search.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";
import { bearerHeaders } from "../../support/route-request";

function createApp(role: "admin" | "user" = "admin") {
  const searchService = {
    startReindex: jest.fn(async () => ({ id: "run-1", status: "pending" })),
    getReindexRun: jest.fn(async () => ({ id: "run-1", status: "running" })),
    getStatus: jest.fn(async () => ({ ok: true, lastCompletedRunId: "run-0" })),
    replayDeadLetteredOutbox: jest.fn(async (limit: number) => ({
      accepted: true,
      limit,
    })),
    cleanupRetainedIndices: jest.fn(async () => ({ accepted: true })),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.searchController,
      new SearchController(searchService as never),
    ],
    [
      containerTokens.tokenService,
      {
        verifyAccessToken: jest.fn(async () =>
          createJwtClaims({
            sub: role === "admin" ? "admin-1" : "user-1",
            email: `${role}@example.com`,
            role,
          }),
        ),
      },
    ],
  ]);

  return { app: createRouteTestApp(registry), searchService };
}

describe("Posting search admin routes integration", () => {
  it("starts a reindex run", async () => {
    const { app, searchService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/reindex")}`,
      { method: "POST", headers: bearerHeaders("admin-token") },
    );

    expect(response.status).toBe(202);
    expect(searchService.startReindex).toHaveBeenCalled();
  });

  it("reads a reindex run by id", async () => {
    const { app, searchService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/reindex-runs/run-1")}`,
      { headers: bearerHeaders("admin-token") },
    );

    expect(response.status).toBe(200);
    expect(searchService.getReindexRun).toHaveBeenCalledWith("run-1");
  });

  it("reads index status", async () => {
    const { app, searchService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/status")}`,
      { headers: bearerHeaders("admin-token") },
    );

    expect(response.status).toBe(200);
    expect(searchService.getStatus).toHaveBeenCalled();
  });

  it("replays dead-lettered outbox entries with the requested limit", async () => {
    const { app, searchService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/outbox/replay-dead-lettered?limit=25")}`,
      { method: "POST", headers: bearerHeaders("admin-token") },
    );

    expect(response.status).toBe(202);
    expect(searchService.replayDeadLetteredOutbox).toHaveBeenCalledWith(25);
  });

  it("cleans up retained indices", async () => {
    const { app, searchService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/cleanup-retained-indices")}`,
      { method: "POST", headers: bearerHeaders("admin-token") },
    );

    expect(response.status).toBe(202);
    expect(searchService.cleanupRetainedIndices).toHaveBeenCalled();
  });

  it("refuses a non-admin caller", async () => {
    const { app, searchService } = createApp("user");

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/status")}`,
      { headers: bearerHeaders("user-token") },
    );

    expect(response.status).toBe(403);
    expect(searchService.getStatus).not.toHaveBeenCalled();
  });
});
