import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedJsonMock, optionalAuthJsonMock } = vi.hoisted(() => ({
  authenticatedJsonMock: vi.fn(),
  optionalAuthJsonMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
  optionalAuthJson: optionalAuthJsonMock,
}));

const { blogCommentsApi } = await import("@/lib/blog-comments/api");

describe("blogCommentsApi", () => {
  beforeEach(() => {
    authenticatedJsonMock.mockReset();
    optionalAuthJsonMock.mockReset();
  });

  it("reads a thread with optional auth", () => {
    blogCommentsApi.list("org-1", "my-post");

    // Optional rather than authenticated: reading works signed out, and a
    // signed-in reader's capabilities come back in the same envelope.
    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/blog/my-post/comments",
    );
    expect(authenticatedJsonMock).not.toHaveBeenCalled();
  });

  it("passes paging through when asked", () => {
    blogCommentsApi.list("org-1", "my-post", { page: 2, pageSize: 10 });

    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/blog/my-post/comments?page=2&pageSize=10",
    );
  });

  it("encodes an organization id and slug", () => {
    blogCommentsApi.list("org/1", "a b");

    expect(optionalAuthJsonMock).toHaveBeenCalledWith(
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
