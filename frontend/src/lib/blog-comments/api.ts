import { authenticatedJson, publicJson } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
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
   * Reads a page of comments.
   *
   * The path depends on who is asking, which matters more than it looks.
   * `optionalAuthJson` retries a 401 *without* the token rather than
   * refreshing it, so a signed-in reader whose 15-minute access token had
   * expired would silently get the anonymous envelope back — the panel would
   * offer "Sign in to comment" while the header still showed them signed in.
   * A signed-in reader therefore takes the refresh-capable path, and only a
   * genuinely failed refresh falls back to the public one.
   */
  async list(
    organizationId: string,
    slug: string,
    input?: { page?: number; pageSize?: number; authenticated?: boolean },
  ): Promise<BlogCommentListResult> {
    const query = new URLSearchParams();

    if (input?.page !== undefined) {
      query.set("page", String(input.page));
    }

    if (input?.pageSize !== undefined) {
      query.set("pageSize", String(input.pageSize));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
    const path = commentsPath(organizationId, slug, suffix);

    if (!input?.authenticated) {
      return publicJson<BlogCommentListResult>("GET", path);
    }

    try {
      return await authenticatedJson<BlogCommentListResult>("GET", path);
    } catch (error) {
      // The refresh itself failed, so this reader really is signed out. Read
      // the post as a guest rather than showing them an error on a page that
      // is public to everyone else.
      if (error instanceof ApiError && error.status === 401) {
        return publicJson<BlogCommentListResult>("GET", path);
      }

      throw error;
    }
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
