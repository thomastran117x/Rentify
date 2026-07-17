import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDeviceIdMock = vi.fn();
const getDevicePlatformMock = vi.fn();
const readStoredSessionMock = vi.fn();

vi.mock("@/lib/auth/device", () => ({
  getDeviceId: getDeviceIdMock,
  getDevicePlatform: getDevicePlatformMock,
}));

vi.mock("@/lib/auth/storage", () => ({
  readStoredSession: readStoredSessionMock,
}));

function jsonResponse(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      success: true,
      message: "ok",
      data,
      error: null,
      meta: { requestId: "request-1" },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("organizationsApi announcements", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "org-access-token",
      device: { known: true, knownByIp: false },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "owner",
      },
    });
    document.cookie = "csrf_token=org-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists announcements with an authenticated GET request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        announcements: [],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.listAnnouncements("org-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/announcements?pageSize=50",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer org-access-token",
        }),
      }),
    );
  });

  it("creates an announcement with the provided payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          id: "announcement-1",
          organizationId: "org-1",
          title: "Title",
          body: "Body",
          status: "published",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.createAnnouncement("org-1", {
      title: "Title",
      body: "Body",
      status: "published",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/announcements",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Title",
          body: "Body",
          status: "published",
        }),
      }),
    );
  });

  it("updates an announcement with a PATCH request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "announcement-1",
        organizationId: "org-1",
        title: "Title",
        body: "Body",
        status: "draft",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.updateAnnouncement("org-1", "announcement-1", {
      status: "draft",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/announcements/announcement-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "draft" }),
      }),
    );
  });

  it("deletes an announcement with a DELETE request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ deleted: true, announcementId: "announcement-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.deleteAnnouncement("org-1", "announcement-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/announcements/announcement-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
