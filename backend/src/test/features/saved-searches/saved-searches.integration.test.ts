import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { SavedSearchesController } from "@/features/saved-searches/saved-searches.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

function makeSavedSearch(overrides: Record<string, unknown> = {}) {
  return {
    id: "ss-1",
    userId: "user-1",
    name: "Camera Search",
    searchParams: { family: "equipment", city: "Vancouver" },
    alertEnabled: true,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function createApp() {
  const savedSearchesService = {
    create: jest.fn(async () => makeSavedSearch()),
    list: jest.fn(async () => [makeSavedSearch()]),
    update: jest.fn(async () => makeSavedSearch({ name: "Updated" })),
    delete: jest.fn(async () => undefined),
  };

  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "user-token") {
        return createJwtClaims({ sub: "user-1", email: "user@example.com" });
      }

      throw new UnauthorizedError("Invalid access token signature.");
    }),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.savedSearchesController,
      new SavedSearchesController(savedSearchesService as never),
    ],
    [containerTokens.tokenService, tokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    savedSearchesService,
  };
}

function authHeaders(token = "user-token") {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("Saved searches integration", () => {
  it("creates, lists, updates, and deletes a saved search", async () => {
    const { app, savedSearchesService } = createApp();

    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: "Camera Search",
          searchParams: { family: "equipment", city: "Vancouver" },
          alertEnabled: true,
        }),
      },
    );
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(savedSearchesService.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "Camera Search" }),
    );
    expect(createPayload.data).toMatchObject({
      id: "ss-1",
      name: "Camera Search",
    });

    const listResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches")}`,
      { headers: authHeaders() },
    );
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(savedSearchesService.list).toHaveBeenCalledWith("user-1");
    expect(Array.isArray(listPayload.data)).toBe(true);
    expect(listPayload.data).toHaveLength(1);

    const updateResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches/ss-1")}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Updated" }),
      },
    );
    const updatePayload = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(savedSearchesService.update).toHaveBeenCalledWith(
      "user-1",
      "ss-1",
      expect.objectContaining({ name: "Updated" }),
    );
    expect(updatePayload.data).toMatchObject({ name: "Updated" });

    const deleteResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches/ss-1")}`,
      { method: "DELETE", headers: authHeaders() },
    );

    expect(deleteResponse.status).toBe(204);
    expect(savedSearchesService.delete).toHaveBeenCalledWith("user-1", "ss-1");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/saved-searches")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Camera Search",
          searchParams: {},
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for requests with an invalid body", async () => {
    const { app } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/saved-searches")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ searchParams: { family: "equipment" } }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
  });

  it("surfaces service errors as appropriate HTTP responses", async () => {
    const { app, savedSearchesService } = createApp();

    savedSearchesService.create.mockRejectedValueOnce(
      new ConflictError("Saved search limit reached."),
    );

    const conflictResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "11th search", searchParams: {} }),
      },
    );

    expect(conflictResponse.status).toBe(409);

    savedSearchesService.update.mockRejectedValueOnce(
      new ResourceNotFoundError("Saved search not found."),
    );

    const notFoundResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches/missing")}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ alertEnabled: false }),
      },
    );

    expect(notFoundResponse.status).toBe(404);

    savedSearchesService.delete.mockRejectedValueOnce(
      new ForbiddenError("Not your saved search."),
    );

    const forbiddenResponse = await app.request(
      `http://rent.test${buildApiPath("/saved-searches/ss-1")}`,
      { method: "DELETE", headers: authHeaders() },
    );

    expect(forbiddenResponse.status).toBe(403);
  });
});
