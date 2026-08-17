/** Longest comment the server accepts. Mirrors the backend model. */
export const MAX_BLOG_COMMENT_LENGTH = 2000;

/** How long an author may edit their own comment. Mirrors the backend model. */
export const BLOG_COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Who wrote a comment, as served on a public page. Deliberately carries no
 * email address, unlike the booking thread's author summary.
 */
export interface BlogCommentAuthorSummary {
  id: string;
  username: string;
  avatarUrl?: string;
}

/** Who tombstoned a comment, in the only terms a reader needs. */
export type BlogCommentDeletedBy = "author" | "moderator";

export interface BlogCommentRecord {
  id: string;
  blogPostId: string;
  organizationId: string;
  author: BlogCommentAuthorSummary;
  /** Empty once deleted — the tombstone is the record, not the text. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: BlogCommentDeletedBy | null;
}

export interface BlogCommentPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * The list envelope. Every per-viewer capability lives here rather than on a
 * comment, because comments are broadcast to a room and a capability computed
 * for one reader would be wrong for the rest.
 */
export interface BlogCommentListResult {
  comments: BlogCommentRecord[];
  pagination: BlogCommentPagination;
  commentsEnabled: boolean;
  viewerCanComment: boolean;
  viewerCanModerate: boolean;
  viewerUserId: string | null;
}

/**
 * Server-to-client frames. The event name is the `type` field and the payload
 * is the whole member, so a client can filter on `blogPostId` before it
 * dispatches.
 */
export type BlogCommentStreamEvent =
  | { type: "comment.created"; blogPostId: string; comment: BlogCommentRecord }
  | { type: "comment.updated"; blogPostId: string; comment: BlogCommentRecord }
  | { type: "comment.deleted"; blogPostId: string; comment: BlogCommentRecord }
  | { type: "typing"; blogPostId: string; username: string; expiresAt: string }
  | { type: "presence"; blogPostId: string; readerCount: number }
  | {
      type: "comments.closed";
      blogPostId: string;
      commentsEnabled: boolean;
    }
  | { type: "resync"; blogPostId: string };

export type BlogCommentStreamStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "failed";
