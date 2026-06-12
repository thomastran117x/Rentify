import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { BlobController } from "@/features/blob/blob.controller";
import { ProfileController } from "@/features/profile/profile.controller";
import { SearchController } from "@/features/search/search.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

function createPagination() {
  return {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

function createApp() {
  const blobService = {
    createUploadUrl: jest.fn((input: { filename: string; scope?: string }) => ({
      method: "PUT" as const,
      uploadUrl: "http://localhost/upload",
      expiresAt: "2026-06-30T00:00:00.000Z",
      blobName: `postings/${input.filename}`,
      blobUrl: `http://localhost/blob/postings/${input.filename}`,
      container: "rent",
      headers: {
        "x-ms-blob-type": "BlockBlob" as const,
        "content-type": "image/jpeg",
      },
      scope: input.scope,
    })),
    uploadLocalBlob: jest.fn(async () => undefined),
    readLocalBlob: jest.fn(async () => ({
      contentType: "text/plain",
      body: Buffer.from("hello"),
    })),
  };

  const profileService = {
    list: jest.fn(async () => ({
      profiles: [
        {
          id: "profile-1",
          userId: "user-1",
          email: "user@example.com",
          username: "test-user",
          isPrivate: false,
          recommendationPersonalizationEnabled: true,
          trustworthinessScore: 4,
          rentPostingsCount: 2,
          availableRentPostingsCount: 1,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      pagination: createPagination(),
    })),
    getByUserId: jest.fn(async (userId: string) => ({
      id: "profile-1",
      userId,
      email: "user@example.com",
      username: "test-user",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 4,
      rentPostingsCount: 2,
      availableRentPostingsCount: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    })),
    update: jest.fn(async (input: { userId: string; username: string }) => ({
      id: "profile-1",
      userId: input.userId,
      email: "user@example.com",
      username: input.username,
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 4,
      rentPostingsCount: 2,
      availableRentPostingsCount: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
    })),
  };

  const searchService = {
    startReindex: jest.fn(async () => ({
      id: "run-1",
      status: "pending",
    })),
    getReindexRun: jest.fn(async () => ({
      id: "run-1",
      status: "running",
    })),
    getStatus: jest.fn(async () => ({
      ok: true,
      lastCompletedRunId: "run-0",
    })),
    replayDeadLetteredOutbox: jest.fn(async (limit: number) => ({
      accepted: true,
      limit,
    })),
    cleanupRetainedIndices: jest.fn(async () => ({
      accepted: true,
    })),
  };

  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "admin-token") {
        return createJwtClaims({
          sub: "admin-1",
          email: "admin@example.com",
          role: "admin",
        });
      }

      return createJwtClaims();
    }),
  };

  const registry = new Map<unknown, unknown>([
    [containerTokens.blobController, new BlobController(blobService as never)],
    [
      containerTokens.profileController,
      new ProfileController(profileService as never),
    ],
    [containerTokens.searchController, new SearchController(searchService as never)],
    [containerTokens.tokenService, tokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    blobService,
    profileService,
    searchService,
  };
}

describe("Misc integration", () => {
  it("covers blob upload URL, local upload, and local file retrieval endpoints", async () => {
    const { app, blobService } = createApp();

    const createUrlResponse = await app.request(
      `http://rent.test${buildApiPath("/blob/upload-url")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          filename: "photo.jpg",
          contentType: "image/jpeg",
          scope: "postings/photos",
        }),
      },
    );
    const uploadLocalResponse = await app.request(
      `http://rent.test${buildApiPath("/blob/upload?blobName=postings/photo.jpg&expiresAt=2026-06-30T00:00:00.000Z&token=upload-token")}`,
      {
        method: "PUT",
        headers: {
          "content-type": "text/plain",
        },
        body: "hello",
      },
    );
    const getLocalResponse = await app.request(
      `http://rent.test${buildApiPath("/blob/file?blobName=postings/photo.jpg")}`,
    );

    expect(createUrlResponse.status).toBe(201);
    expect(uploadLocalResponse.status).toBe(201);
    expect(getLocalResponse.status).toBe(200);
    expect(blobService.createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        filename: "photo.jpg",
        contentType: "image/jpeg",
        scope: "postings/photos",
      }),
    );
    expect(blobService.uploadLocalBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        blobName: "postings/photo.jpg",
        contentType: "text/plain",
      }),
    );
    expect(blobService.readLocalBlob).toHaveBeenCalledWith("postings/photo.jpg");
  });

  it("covers profile listing and signed-in profile endpoints", async () => {
    const { app, profileService } = createApp();

    const listResponse = await app.request(
      `http://rent.test${buildApiPath("/profiles?page=1&pageSize=20&q=test")}`,
    );
    const getMeResponse = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        headers: {
          authorization: "Bearer user-token",
        },
      },
    );
    const updateMeResponse = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        method: "PUT",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "updated-user",
          phoneNumber: "+1 416 555 0100",
          isPrivate: false,
          recommendationPersonalizationEnabled: true,
          avatarUrl: "https://example.com/avatar.jpg",
          avatarBlobName: "avatars/user-1.jpg",
          trustworthinessScore: 4,
          rentPostingsCount: 2,
          availableRentPostingsCount: 1,
        }),
      },
    );

    expect(listResponse.status).toBe(200);
    expect(getMeResponse.status).toBe(200);
    expect(updateMeResponse.status).toBe(200);
    expect(profileService.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      query: "test",
    });
    expect(profileService.getByUserId).toHaveBeenCalledWith("user-1");
    expect(profileService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        username: "updated-user",
      }),
    );
  });

  it("covers admin search endpoints", async () => {
    const { app, searchService } = createApp();

    const startReindexResponse = await app.request(
      `http://rent.test${buildApiPath("/admin/search/reindex")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-token",
        },
      },
    );
    const getReindexRunResponse = await app.request(
      `http://rent.test${buildApiPath("/admin/search/reindex-runs/run-1")}`,
      {
        headers: {
          authorization: "Bearer admin-token",
        },
      },
    );
    const getStatusResponse = await app.request(
      `http://rent.test${buildApiPath("/admin/search/status")}`,
      {
        headers: {
          authorization: "Bearer admin-token",
        },
      },
    );
    const replayResponse = await app.request(
      `http://rent.test${buildApiPath("/admin/search/outbox/replay-dead-lettered?limit=25")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-token",
        },
      },
    );
    const cleanupResponse = await app.request(
      `http://rent.test${buildApiPath("/admin/search/cleanup-retained-indices")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer admin-token",
        },
      },
    );

    expect(startReindexResponse.status).toBe(202);
    expect(getReindexRunResponse.status).toBe(200);
    expect(getStatusResponse.status).toBe(200);
    expect(replayResponse.status).toBe(202);
    expect(cleanupResponse.status).toBe(202);
    expect(searchService.startReindex).toHaveBeenCalled();
    expect(searchService.getReindexRun).toHaveBeenCalledWith("run-1");
    expect(searchService.getStatus).toHaveBeenCalled();
    expect(searchService.replayDeadLetteredOutbox).toHaveBeenCalledWith(25);
    expect(searchService.cleanupRetainedIndices).toHaveBeenCalled();
  });
});
