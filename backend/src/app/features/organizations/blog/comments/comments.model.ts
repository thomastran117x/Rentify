import { z } from "zod";
import { organizationResourceIdSchema } from "@/features/organizations/organizations.model";
import { organizationBlogSlugSchema } from "@/features/organizations/blog/blog.model";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/features/postings/postings.model";

export const MAX_BLOG_COMMENT_LENGTH = 2000;

/**
 * How long an author may edit their own comment. A fixed window is predictable
 * for the author and bounds how far a comment other people have already replied
 * around can be rewritten after the fact.
 *
 * Deletion has no such window: withdrawing what you said should always be
 * possible, and the tombstone it leaves is honest about what happened.
 */
export const BLOG_COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * A browser cannot set an `Authorization` header on the Socket.IO handshake, so
 * a client exchanges its session for a short-lived single-use ticket over REST.
 * The ticket comes back as an HttpOnly cookie scoped to the socket path, keeping
 * it out of URLs and proxy logs; the short life bounds what a leaked one buys.
 *
 * Anonymous readers mint one too. It carries no identity, but it is still what
 * binds the socket to a post server-side, so a client never names its own room.
 */
export const BLOG_COMMENT_SOCKET_TICKET_TTL_SECONDS = 30;

/** Path the client upgrades on, and the cookie's scope. */
export const BLOG_COMMENT_SOCKET_PATH = "/ws/blog-comments";

/**
 * HttpOnly cookie carrying the upgrade ticket, scoped to the socket path.
 *
 * Deliberately distinct from the booking gateway's `rentify_ws_ticket`. Path
 * scoping alone would already keep the browser from sending one to the other,
 * but a separate name removes any chance of either gateway redeeming a ticket
 * minted for the other if a scope is ever widened by accident.
 */
export const BLOG_COMMENT_SOCKET_COOKIE_NAME = "rentify_blog_ws_ticket";

/** How long a typing indicator stands before it expires on its own. */
export const BLOG_COMMENT_TYPING_TTL_SECONDS = 6;

/**
 * Per-author write budget, enforced in the service.
 *
 * The middleware rate limiter keys on IP address, which is the wrong axis for a
 * public comment form: a shared NAT makes strangers share a bucket, and a
 * rotating address evades it entirely. This bounds one account instead.
 */
export const BLOG_COMMENT_AUTHOR_RATE_LIMIT = 10;
export const BLOG_COMMENT_AUTHOR_RATE_WINDOW_SECONDS = 60;

// `.trim()` runs before the length checks, so a whitespace-only body is
// rejected and a 2000-character body with trailing spaces is accepted.
export const createBlogCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Comment body is required.")
      .max(
        MAX_BLOG_COMMENT_LENGTH,
        `Comment body cannot exceed ${MAX_BLOG_COMMENT_LENGTH} characters.`,
      ),
  })
  .strict();

export const updateBlogCommentSchema = createBlogCommentSchema;

export const listBlogCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export const blogCommentIdSchema = organizationResourceIdSchema;
export const blogCommentPostSlugSchema = organizationBlogSlugSchema;

export type CreateBlogCommentBody = z.infer<typeof createBlogCommentSchema>;
export type UpdateBlogCommentBody = z.infer<typeof updateBlogCommentSchema>;
export type ListBlogCommentsQuery = z.infer<typeof listBlogCommentsQuerySchema>;

/**
 * Who wrote a comment, as shown to the world.
 *
 * Deliberately narrower than `OrganizationBlogAuthorSummary`, which carries an
 * email: a booking thread is private, but a blog comment is world-readable, so
 * an address must never travel with one.
 */
export interface BlogCommentAuthorSummary {
  id: string;
  username: string;
  avatarUrl?: string;
}

/** Who tombstoned a comment, in the only terms a public reader needs. */
export type BlogCommentDeletedBy = "author" | "moderator";

export interface OrganizationBlogCommentRecord {
  id: string;
  blogPostId: string;
  organizationId: string;
  author: BlogCommentAuthorSummary;
  /** Empty once deleted — the tombstone is the record, not the text. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /**
   * Never a user id: naming the manager who removed a comment on a public page
   * would expose staff to the person they moderated.
   */
  deletedBy: BlogCommentDeletedBy | null;
}

export interface OrganizationBlogCommentPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * The list envelope, and the only place per-viewer capabilities appear.
 *
 * They cannot ride on `OrganizationBlogCommentRecord`, because that record is
 * broadcast to a room: a `canModerate` computed for whoever triggered the write
 * would be correct for them and wrong for every other reader in the room.
 */
export interface ListOrganizationBlogCommentsResult {
  comments: OrganizationBlogCommentRecord[];
  pagination: OrganizationBlogCommentPagination;
  commentsEnabled: boolean;
  viewerCanComment: boolean;
  viewerCanModerate: boolean;
  /** Null while anonymous. Lets the client resolve its own comments locally. */
  viewerUserId: string | null;
}

export interface ListOrganizationBlogCommentsInput {
  organizationId: string;
  slug: string;
  actorUserId: string | null;
  page: number;
  pageSize: number;
}

export interface CreateOrganizationBlogCommentInput {
  organizationId: string;
  slug: string;
  actorUserId: string;
  body: string;
}

export interface UpdateOrganizationBlogCommentInput {
  organizationId: string;
  slug: string;
  commentId: string;
  actorUserId: string;
  body: string;
}

export interface DeleteOrganizationBlogCommentInput {
  organizationId: string;
  slug: string;
  commentId: string;
  actorUserId: string;
}

/** The post fields every authorization decision in this feature depends on. */
export interface OrganizationBlogCommentPostContext {
  id: string;
  organizationId: string;
  status: string;
  commentsEnabled: boolean;
}

export interface OrganizationBlogCommentStreamAuthorization {
  blogPostId: string;
  organizationId: string;
  /**
   * Whether this viewer may post. Connecting only needs read access — an
   * anonymous reader watches a thread they cannot write to — so the capability
   * travels separately from the permission to be here at all.
   */
  canWrite: boolean;
  canModerate: boolean;
}

export interface OrganizationBlogCommentSocketTicket {
  /** Never returned to the browser: it is delivered as an HttpOnly cookie. */
  ticket: string;
  expiresInSeconds: number;
}

/** The session details a ticket carries, taken from the minting request. */
export interface OrganizationBlogCommentSocketSession {
  sessionId?: string | null;
  tokenVersion?: number | null;
}

export interface OrganizationBlogCommentSocketIdentity {
  blogPostId: string;
  organizationId: string;
  /** Null for an anonymous reader — the whole point of the public surface. */
  userId: string | null;
  sessionId: string | null;
  tokenVersion: number | null;
}

/**
 * Server-to-client frames. The event name is the `type` field and the payload is
 * the whole member, so a client can filter on `blogPostId` before dispatching.
 */
export type OrganizationBlogCommentStreamEvent =
  | {
      type: "comment.created";
      blogPostId: string;
      comment: OrganizationBlogCommentRecord;
    }
  | {
      type: "comment.updated";
      blogPostId: string;
      comment: OrganizationBlogCommentRecord;
    }
  | {
      /**
       * Separate from `comment.updated`, unlike the booking thread which folds
       * deletion into its update event. A reader has to be able to tell an
       * author withdrawing their words from an organization removing them, and
       * the two are rendered with different copy.
       */
      type: "comment.deleted";
      blogPostId: string;
      comment: OrganizationBlogCommentRecord;
    }
  | {
      // Ephemeral: never persisted, and expires on its own if the author goes
      // quiet or their socket drops.
      type: "typing";
      blogPostId: string;
      username: string;
      expiresAt: string;
    }
  | {
      /**
       * How many sockets are in the post's room, counted by asking the adapter
       * rather than by keeping a tally — a tally on one node cannot survive
       * another node dying with sockets attached.
       */
      type: "presence";
      blogPostId: string;
      readerCount: number;
    }
  | {
      /** Broadcast when a manager opens or closes comments on the post. */
      type: "comments.closed";
      blogPostId: string;
      commentsEnabled: boolean;
    }
  | {
      /**
       * Tells one client its own capabilities may have changed and it should
       * refetch. Deliberately carries no values: the list response is already
       * the single source for every `viewerCan*` field.
       */
      type: "resync";
      blogPostId: string;
    };

/** Sent to a single socket the moment it is admitted to a room. */
export interface OrganizationBlogCommentReadyEvent {
  type: "ready";
  blogPostId: string;
  canWrite: boolean;
}
