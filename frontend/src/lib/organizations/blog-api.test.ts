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

const emptyList = {
  posts: [],
  pagination: {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

describe("organizationsApi blog posts", () => {
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

  it("lists management blog posts with an authenticated GET request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(emptyList));
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.listBlogPosts("org-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/blog-posts?pageSize=50",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer org-access-token",
        }),
      }),
    );
  });

  it("creates a blog post with the provided payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          id: "blog-1",
          organizationId: "org-1",
          title: "Title",
          slug: "title",
          body: "<p>Body</p>",
          tags: ["news"],
          status: "published",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.createBlogPost("org-1", {
      title: "Title",
      body: "<p>Body</p>",
      tags: ["news"],
      status: "published",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/blog-posts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Title",
          body: "<p>Body</p>",
          tags: ["news"],
          status: "published",
        }),
      }),
    );
  });

  it("updates a blog post with a PATCH request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "blog-1",
        organizationId: "org-1",
        title: "Title",
        slug: "title",
        body: "<p>Body</p>",
        tags: [],
        status: "draft",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.updateBlogPost("org-1", "blog-1", {
      status: "draft",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/blog-posts/blog-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "draft" }),
      }),
    );
  });

  it("deletes a blog post with a DELETE request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ deleted: true, blogPostId: "blog-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.deleteBlogPost("org-1", "blog-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/organizations/org-1/blog-posts/blog-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("lists published posts publicly without an auth header", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(emptyList));
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.listPublicBlog("org-1", { page: 2, tag: "news" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "http://localhost:8040/api/v1/organizations/org-1/blog?page=2&tag=news",
    );
    expect(init.method).toBe("GET");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("fetches a single published post by slug publicly", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "blog-1",
        organizationId: "org-1",
        title: "Title",
        slug: "my-post",
        body: "<p>Body</p>",
        tags: [],
        status: "published",
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { organizationsApi } = await import("./api");
    await organizationsApi.getPublicBlogPost("org-1", "my-post");

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8040/api/v1/organizations/org-1/blog/my-post",
    );
  });
});
