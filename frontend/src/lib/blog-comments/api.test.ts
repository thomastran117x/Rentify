import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedJsonMock, publicJsonMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
  publicJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
  publicJson: publicJsonMock,
}));

const { blogCommentsApi } = await import("@/lib/blog-comments/api");
const { ApiError } = await import("@/lib/api/types");

const REQUEST_CONTEXT = {
  method: "GET",
  path: "/organizations/org-1/blog/my-post/comments",
  requestUrl: "https://api.test/api/v1",
};

describe("blogCommentsApi", () => {
  beforeEach(() => {
    authenticatedJsonMock.mockReset();
    publicJsonMock.mockReset();
  });

  it("reads a thread publicly for a guest", async () => {
    await blogCommentsApi.list("org-1", "my-post");

    expect(publicJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/blog/my-post/comments",
    );
    expect(authenticatedJsonMock).not.toHaveBeenCalled();
  });

  it("reads a thread on the refreshing path for a signed-in reader", async () => {
    await blogCommentsApi.list("org-1", "my-post", { authenticated: true });

    // `optionalAuthJson` retries a 401 without the token instead of refreshing
    // it, which would hand a signed-in reader the anonymous envelope and hide
    // their own composer.
    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/blog/my-post/comments",
    );
    expect(publicJsonMock).not.toHaveBeenCalled();
  });

  it("falls back to the public read when the refresh genuinely fails", async () => {
    authenticatedJsonMock.mockRejectedValueOnce(
      new ApiError("Unauthorized", {
        code: "UNAUTHORIZED",
        status: 401,
        request: REQUEST_CONTEXT,
      }),
    );

    await blogCommentsApi.list("org-1", "my-post", { authenticated: true });

    // They really are signed out; a public page should still render.
    expect(publicJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/blog/my-post/comments",
    );
  });

  it("rethrows a failure that is not an expired session", async () => {
    authenticatedJsonMock.mockRejectedValueOnce(
      new ApiError("Server exploded", {
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        request: REQUEST_CONTEXT,
      }),
    );

    await expect(
      blogCommentsApi.list("org-1", "my-post", { authenticated: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(publicJsonMock).not.toHaveBeenCalled();
  });

  it("passes paging through when asked", async () => {
    await blogCommentsApi.list("org-1", "my-post", { page: 2, pageSize: 10 });

    expect(publicJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/blog/my-post/comments?page=2&pageSize=10",
    );
  });

  it("encodes an organization id and slug", async () => {
    await blogCommentsApi.list("org/1", "a b");

    expect(publicJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org%2F1/blog/a%20b/comments",
    );
  });

  it("posts a comment", () => {
    blogCommentsApi.create("org-1", "my-post", "Great post.");

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "POST",
      "/organizations/org-1/blog/my-post/comments",
      { body: "Great post." },
    );
  });

  it("edits a comment", () => {
    blogCommentsApi.update("org-1", "my-post", "comment-1", "Edited.");

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "PATCH",
      "/organizations/org-1/blog/my-post/comments/comment-1",
      { body: "Edited." },
    );
  });

  it("removes a comment", () => {
    blogCommentsApi.remove("org-1", "my-post", "comment-1");

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "DELETE",
      "/organizations/org-1/blog/my-post/comments/comment-1",
    );
  });

  it("encodes a comment id", () => {
    blogCommentsApi.remove("org-1", "my-post", "a/b");

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "DELETE",
      "/organizations/org-1/blog/my-post/comments/a%2Fb",
    );
  });
});
