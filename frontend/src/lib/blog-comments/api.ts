import { authenticatedJson, optionalAuthJson } from "@/lib/api/client";
import type {
  BlogCommentListResult,
  BlogCommentRecord,
} from "@/lib/blog-comments/types";

function commentsPath(
  organizationId: string,
  slug: string,
  suffix = "",
): string {
  return `/organizations/${encodeURIComponent(organizationId)}/blog/${encodeURIComponent(slug)}/comments${suffix}`;
}

export const blogCommentsApi = {
  /**
   * Optional auth rather than public: reading works while signed out, but a
   * signed-in reader's capabilities come back in the same envelope, so sending
   * the token when there is one saves a second call.
   */
  list(
    organizationId: string,
    slug: string,
    input?: { page?: number; pageSize?: number },
  ): Promise<BlogCommentListResult> {
    const query = new URLSearchParams();

    if (input?.page !== undefined) {
      query.set("page", String(input.page));
    }

    if (input?.pageSize !== undefined) {
      query.set("pageSize", String(input.pageSize));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";

    return optionalAuthJson<BlogCommentListResult>(
      "GET",
      commentsPath(organizationId, slug, suffix),
    );
  },
  create(
    organizationId: string,
    slug: string,
    body: string,
  ): Promise<BlogCommentRecord> {
    return authenticatedJson<BlogCommentRecord, { body: string }>(
      "POST",
      commentsPath(organizationId, slug),
      { body },
    );
  },
  update(
    organizationId: string,
    slug: string,
    commentId: string,
    body: string,
  ): Promise<BlogCommentRecord> {
    return authenticatedJson<BlogCommentRecord, { body: string }>(
      "PATCH",
      commentsPath(organizationId, slug, `/${encodeURIComponent(commentId)}`),
      { body },
    );
  },
  remove(
    organizationId: string,
    slug: string,
    commentId: string,
  ): Promise<BlogCommentRecord> {
    return authenticatedJson<BlogCommentRecord>(
      "DELETE",
      commentsPath(organizationId, slug, `/${encodeURIComponent(commentId)}`),
    );
  },
};
