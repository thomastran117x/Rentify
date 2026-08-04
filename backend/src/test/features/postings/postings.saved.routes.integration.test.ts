import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { PostingsController } from "@/features/postings/postings.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

function createApp() {
  const postingsService = {
    getById: jest.fn(async () => ({ id: "posting-1" })),
  };
  const savedPostingsService = {
    list: jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      unavailablePostings: [],
    })),
    listIds: jest.fn(async () => ({
      postingIds: ["posting-1"],
      truncated: false,
    })),
    save: jest.fn(async () => ({
      postingId: "posting-1",
      saved: true,
      savedAt: "2026-08-01T12:00:00.000Z",
    })),
    unsave: jest.fn(async () => ({
      postingId: "posting-1",
      saved: false,
      savedAt: null,
    })),
  };
  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "user-token") {
        return createJwtClaims();
      }

      throw new UnauthorizedError("Invalid access token signature.");
    }),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.postingsController,
      new PostingsController(
        postingsService as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        savedPostingsService as any,
      ),
    ],
    [containerTokens.tokenService, tokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    postingsService,
    savedPostingsService,
  };
}

function userHeaders() {
  return {
    authorization: "Bearer user-token",
    "content-type": "application/json",
  };
}

describe("Saved postings routes integration", () => {
  // `saved` is a syntactically valid posting identifier, so a registry
  // reordering that let `/postings/:id` bind first would turn this endpoint
  // into a plausible-looking 404 rather than an obvious failure.
  it("routes GET /postings/saved to listSaved rather than the posting detail handler", async () => {
    const { app, postingsService, savedPostingsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings/saved?page=2&pageSize=5")}`,
      { headers: userHeaders() },
    );

    expect(response.status).toBe(200);
    expect(savedPostingsService.list).toHaveBeenCalledWith("user-1", 2, 5);
    expect(postingsService.getById).not.toHaveBeenCalled();
  });

  it("routes GET /postings/saved/ids to listSavedIds", async () => {
    const { app, postingsService, savedPostingsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings/saved/ids")}`,
      { headers: userHeaders() },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: { postingIds: ["posting-1"], truncated: false },
      }),
    );
    expect(savedPostingsService.listIds).toHaveBeenCalledWith("user-1");
    expect(postingsService.getById).not.toHaveBeenCalled();
  });

  it("saves a posting with 200 and a state body", async () => {
    const { app, savedPostingsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/save")}`,
      { method: "POST", headers: userHeaders() },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        message: "Posting saved successfully.",
        data: {
          postingId: "posting-1",
          saved: true,
          savedAt: "2026-08-01T12:00:00.000Z",
        },
      }),
    );
    expect(savedPostingsService.save).toHaveBeenCalledWith(
      "posting-1",
      "user-1",
    );
  });

  it("unsaves a posting with 200 and a state body", async () => {
    const { app, savedPostingsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/save")}`,
      { method: "DELETE", headers: userHeaders() },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        message: "Posting removed from saved postings.",
        data: {
          postingId: "posting-1",
          saved: false,
          savedAt: null,
        },
      }),
    );
    expect(savedPostingsService.unsave).toHaveBeenCalledWith(
      "posting-1",
      "user-1",
    );
  });

  it.each([
    ["GET", "/postings/saved"],
    ["GET", "/postings/saved/ids"],
    ["POST", "/postings/posting-1/save"],
    ["DELETE", "/postings/posting-1/save"],
  ])("rejects unauthenticated %s %s", async (method, path) => {
    const { app, savedPostingsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath(path)}`,
      { method },
    );

    expect(response.status).toBe(401);
    expect(savedPostingsService.list).not.toHaveBeenCalled();
    expect(savedPostingsService.save).not.toHaveBeenCalled();
    expect(savedPostingsService.unsave).not.toHaveBeenCalled();
  });

  it("rejects an invalid page size", async () => {
    const { app, savedPostingsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings/saved?pageSize=999")}`,
      { headers: userHeaders() },
    );

    expect(response.status).toBe(400);
    expect(savedPostingsService.list).not.toHaveBeenCalled();
  });
});
