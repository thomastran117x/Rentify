import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationsApi } from "./api";

const { authenticatedMock, optionalMock, publicMock } = vi.hoisted(() => ({
  authenticatedMock: vi.fn(),
  optionalMock: vi.fn(),
  publicMock: vi.fn(),
}));
vi.mock("@/lib/auth/api", () => ({
  getAuthenticatedJson: (path: string) => authenticatedMock("GET", path),
  postAuthenticatedJson: (path: string, body: unknown) =>
    authenticatedMock("POST", path, body),
  patchAuthenticatedJson: (path: string, body: unknown) =>
    authenticatedMock("PATCH", path, body),
  putAuthenticatedJson: (path: string, body: unknown) =>
    authenticatedMock("PUT", path, body),
  deleteAuthenticatedJson: (path: string) => authenticatedMock("DELETE", path),
  getOptionalAuthJson: (path: string) => optionalMock("GET", path),
}));
vi.mock("@/lib/api/client", () => ({
  publicJson: publicMock,
}));

describe("organizationsApi", () => {
  beforeEach(() => vi.clearAllMocks());
  const id = "org-1";
  it("covers public directory, blog, and review reads with optional filter paths", () => {
    organizationsApi.listPublic();
    organizationsApi.listPublic({ page: 2, pageSize: 50, query: " studio " });
    organizationsApi.getPublicById(id);
    organizationsApi.listPublicBlog(id);
    organizationsApi.listPublicBlog(id, {
      page: 2,
      pageSize: 10,
      tag: " news ",
      q: " launch ",
      sort: "oldest",
    } as never);
    organizationsApi.getPublicBlogPost(id, "hello / world");
    organizationsApi.searchBlogFeed();
    organizationsApi.searchBlogFeed({
      page: 2,
      pageSize: 20,
      tag: "news",
      q: "launch",
      sort: "newest",
    } as never);
    organizationsApi.listPublicReviews(id);
    organizationsApi.listPublicReviews(id, { page: 2, pageSize: 10 });
    organizationsApi.getOwnReview(id);
    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/org-1/reviews/me",
    );
  });
  it("covers workspace, content, review, settings, membership, and invitation actions", () => {
    organizationsApi.getMine();
    organizationsApi.create({} as never);
    organizationsApi.setActive({ organizationId: id });
    organizationsApi.listAudit(id);
    organizationsApi.restoreAuditEntry(id, "audit-1");
    organizationsApi.listAnnouncements(id);
    organizationsApi.createAnnouncement(id, {} as never);
    organizationsApi.updateAnnouncement(id, "announcement-1", {} as never);
    organizationsApi.deleteAnnouncement(id, "announcement-1");
    organizationsApi.listBlogPosts(id);
    organizationsApi.createBlogPost(id, {} as never);
    organizationsApi.updateBlogPost(id, "post-1", {} as never);
    organizationsApi.deleteBlogPost(id, "post-1");
    organizationsApi.createReview(id, {} as never);
    organizationsApi.updateOwnReview(id, {} as never);
    organizationsApi.deleteOwnReview(id);
    organizationsApi.replyToReview(id, "review-1", "Thanks");
    organizationsApi.removeReviewReply(id, "review-1");
    organizationsApi.deleteReview(id, "review-1");
    organizationsApi.getWorkspaceById(id);
    organizationsApi.update(id, {} as never);
    organizationsApi.rename(id, "New name");
    organizationsApi.updateSlug(id, "new-name");
    organizationsApi.createInvite(id, {} as never);
    organizationsApi.revokeInvite(id, "invite-1");
    organizationsApi.updateMemberRole(id, "member-1", "operator");
    organizationsApi.removeMember(id, "member-1");
    organizationsApi.previewInvite("token / 1");
    organizationsApi.acceptInvite("token / 1");
    expect(authenticatedMock).toHaveBeenCalledWith("GET", "/organizations/me");
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/organizations/org-1/audit/audit-1/restore",
      {},
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "PUT",
      "/organizations/org-1/reviews/review-1/reply",
      { body: "Thanks" },
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "PATCH",
      "/organizations/org-1/members/member-1",
      { role: "operator" },
    );
    expect(optionalMock).toHaveBeenCalledWith(
      "GET",
      "/organizations/invitations/token%20%2F%201",
    );
  });
});
