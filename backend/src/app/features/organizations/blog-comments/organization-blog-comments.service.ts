import { randomBytes } from "node:crypto";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { TokenService } from "@/features/auth/token/token.service";
import type { CacheService } from "@/features/cache/cache.service";
import type { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationBlogCommentsRepository } from "@/features/organizations/blog-comments/organization-blog-comments.repository";
import type {
  CreateOrganizationBlogCommentInput,
  DeleteOrganizationBlogCommentInput,
  ListOrganizationBlogCommentsInput,
  ListOrganizationBlogCommentsResult,
  OrganizationBlogCommentPostContext,
  OrganizationBlogCommentRecord,
  OrganizationBlogCommentSocketIdentity,
  OrganizationBlogCommentSocketSession,
  OrganizationBlogCommentSocketTicket,
  OrganizationBlogCommentStreamAuthorization,
  OrganizationBlogCommentStreamEvent,
  UpdateOrganizationBlogCommentInput,
} from "@/features/organizations/blog-comments/organization-blog-comments.model";
import {
  BLOG_COMMENT_AUTHOR_RATE_LIMIT,
  BLOG_COMMENT_AUTHOR_RATE_WINDOW_SECONDS,
  BLOG_COMMENT_EDIT_WINDOW_MS,
  BLOG_COMMENT_SOCKET_TICKET_TTL_SECONDS,
} from "@/features/organizations/blog-comments/organization-blog-comments.model";

/**
 * The realtime seam. Narrowed to what this service needs so it does not depend
 * on the whole Socket.IO gateway, and so tests can stand in for it without a
 * server. The gateway has no constructor dependencies of its own, which is what
 * keeps this edge from closing a cycle.
 */
export interface OrganizationBlogCommentRealtimeGateway {
  publish(event: OrganizationBlogCommentStreamEvent): void;
  countReaders(blogPostId: string): Promise<number>;
}

export class OrganizationBlogCommentsService {
  private readonly logger: Logger;

  constructor(
    private readonly repository: OrganizationBlogCommentsRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly contentSanitizationService: ContentSanitizationService,
    private readonly cacheService: CacheService,
    private readonly tokenService: TokenService,
    private readonly realtimeGateway: OrganizationBlogCommentRealtimeGateway,
  ) {
    this.logger = loggerFactory.forClass(
      OrganizationBlogCommentsService,
      "service",
    );
  }

  async list(
    input: ListOrganizationBlogCommentsInput,
  ): Promise<ListOrganizationBlogCommentsResult> {
    const post = await this.requirePublishedPost(
      input.organizationId,
      input.slug,
    );

    const [page, canModerate] = await Promise.all([
      this.repository.listByPost({
        blogPostId: post.id,
        page: input.page,
        pageSize: input.pageSize,
      }),
      this.resolveCanModerate(input.actorUserId, post.organizationId),
    ]);

    return {
      comments: page.comments,
      pagination: page.pagination,
      commentsEnabled: post.commentsEnabled,
      // Managers are not exempt from a closed thread: closing comments is a
      // statement about the post, not about who is privileged.
      viewerCanComment: Boolean(input.actorUserId) && post.commentsEnabled,
      viewerCanModerate: canModerate,
      viewerUserId: input.actorUserId,
    };
  }

  async create(
    input: CreateOrganizationBlogCommentInput,
  ): Promise<OrganizationBlogCommentRecord> {
    const post = await this.requirePublishedPost(
      input.organizationId,
      input.slug,
    );
    this.assertCommentsOpen(post);
    this.assertSafeBody(input.body);
    await this.assertAuthorCooldown(input.actorUserId);

    const record = await this.repository.create({
      blogPostId: post.id,
      organizationId: post.organizationId,
      authorUserId: input.actorUserId,
      body: input.body,
    });

    await this.publishEvent({
      type: "comment.created",
      blogPostId: post.id,
      comment: record,
    });

    return record;
  }

  async update(
    input: UpdateOrganizationBlogCommentInput,
  ): Promise<OrganizationBlogCommentRecord> {
    const post = await this.requirePublishedPost(
      input.organizationId,
      input.slug,
    );
    this.assertCommentsOpen(post);
    this.assertSafeBody(input.body);

    const existing = await this.requireComment(input.commentId, post.id);

    // Managers remove, they do not rewrite: putting words in someone's mouth
    // under their own name is a different power from taking them down.
    if (existing.author.id !== input.actorUserId) {
      throw new ForbiddenError("You can only edit your own comments.");
    }

    const updated = await this.repository.updateBodyIfEligible({
      commentId: existing.id,
      blogPostId: post.id,
      authorUserId: input.actorUserId,
      body: input.body,
      editedAt: new Date(),
      notBefore: this.editWindowStart(),
    });

    if (!updated) {
      // Lost a race with a concurrent delete, or the edit window closed.
      throw new ConflictError("This comment can no longer be edited.");
    }

    await this.publishEvent({
      type: "comment.updated",
      blogPostId: post.id,
      comment: updated,
    });

    return updated;
  }

  async softDelete(
    input: DeleteOrganizationBlogCommentInput,
  ): Promise<OrganizationBlogCommentRecord> {
    // Deliberately not gated on `assertCommentsOpen`: closing a thread must not
    // trap what is already on it. Withdrawing your own words, and a manager
    // removing something, both have to keep working on a closed post.
    const post = await this.requirePublishedPost(
      input.organizationId,
      input.slug,
    );
    const existing = await this.requireComment(input.commentId, post.id);
    const canModerate = await this.resolveCanModerate(
      input.actorUserId,
      post.organizationId,
    );
    const isAuthor = existing.author.id === input.actorUserId;

    if (!isAuthor && !canModerate) {
      throw new ForbiddenError(
        "You do not have permission to remove this comment.",
      );
    }

    const deleted = await this.repository.softDeleteIfEligible({
      commentId: existing.id,
      blogPostId: post.id,
      deletedAt: new Date(),
      deletedByUserId: input.actorUserId,
      // An author removing their own comment is recorded as the author even
      // when they also manage the organization, so the tombstone reads
      // honestly rather than as a moderation action.
      asModerator: !isAuthor,
    });

    if (!deleted) {
      // Already a tombstone. Reported as missing rather than as success, so a
      // double DELETE cannot silently rewrite who removed it and when.
      throw new ResourceNotFoundError("Comment could not be found.");
    }

    await this.publishEvent({
      type: "comment.deleted",
      blogPostId: post.id,
      comment: deleted,
    });

    return deleted;
  }

  /**
   * Broadcasts that a manager opened or closed comments on a post, so open
   * pages drop or restore their composer without a reload.
   */
  publishCommentsToggled(blogPostId: string, commentsEnabled: boolean): void {
    void this.publishEvent({
      type: "comments.closed",
      blogPostId,
      commentsEnabled,
    });
  }

  /**
   * Mints a single-use ticket for the socket upgrade. A browser `WebSocket`
   * cannot send an `Authorization` header, so the session is exchanged here and
   * the ticket is presented on the upgrade instead.
   *
   * `actorUserId` is null for an anonymous reader. They still get a ticket:
   * it is what binds the socket to a post server-side, so a client never names
   * its own room, and it is the only point where an anonymous connection can be
   * throttled at all — the upgrade never reaches Express middleware.
   */
  async createSocketTicket(
    organizationId: string,
    slug: string,
    actor: { userId: string | null } & OrganizationBlogCommentSocketSession,
  ): Promise<OrganizationBlogCommentSocketTicket> {
    // Same bar as reading the post: a ticket must never widen access, and a
    // draft has no stream at all.
    const post = await this.requirePublishedPost(organizationId, slug);

    const ticket = randomBytes(32).toString("base64url");

    const identity: OrganizationBlogCommentSocketIdentity = {
      blogPostId: post.id,
      organizationId: post.organizationId,
      userId: actor.userId,
      // The session that minted the ticket rides along so a signed-in socket
      // can be re-checked against logout and token-version bumps later. An
      // anonymous socket has no session to outlive.
      sessionId: actor.userId ? (actor.sessionId ?? null) : null,
      tokenVersion: actor.userId ? (actor.tokenVersion ?? null) : null,
    };

    await this.cacheService.setJson(
      this.socketTicketKey(ticket),
      identity,
      BLOG_COMMENT_SOCKET_TICKET_TTL_SECONDS,
    );

    return {
      ticket,
      expiresInSeconds: BLOG_COMMENT_SOCKET_TICKET_TTL_SECONDS,
    };
  }

  /**
   * Redeems a ticket exactly once. Deleting before use closes the window where
   * a ticket leaked from a proxy log or browser history could be replayed.
   */
  async redeemSocketTicket(
    ticket: string,
  ): Promise<OrganizationBlogCommentSocketIdentity | null> {
    if (!ticket) {
      return null;
    }

    // Read and removed in one operation. Reading then deleting would let two
    // concurrent upgrades both observe the ticket before either deleted it.
    const identity =
      await this.cacheService.getDeleteJson<OrganizationBlogCommentSocketIdentity>(
        this.socketTicketKey(ticket),
      );

    if (!identity) {
      return null;
    }

    // Re-authorized rather than trusted: the post can be unpublished and a
    // session can be revoked between minting the ticket and the upgrade
    // landing. The periodic sweep closes a connection; it does not stop one
    // from being made inside the ticket's 30-second window.
    try {
      await this.authorizeStream(identity.blogPostId, identity.userId);
      await this.assertSocketSessionValid(identity);
    } catch {
      return null;
    }

    return identity;
  }

  /**
   * What a socket on this post may do right now. Read access is unconditional
   * for a published post — that is what makes the stream public — so the write
   * capability travels separately from the permission to be here at all.
   */
  async authorizeStream(
    blogPostId: string,
    userId: string | null,
  ): Promise<OrganizationBlogCommentStreamAuthorization> {
    const post = await this.repository.findPostForCommentsById(blogPostId);

    if (!post || post.status !== "published") {
      throw new ResourceNotFoundError("Blog post could not be found.");
    }

    const canModerate = await this.resolveCanModerate(
      userId,
      post.organizationId,
    );

    return {
      blogPostId: post.id,
      organizationId: post.organizationId,
      canWrite: Boolean(userId) && post.commentsEnabled,
      canModerate,
    };
  }

  /**
   * Confirms the session behind an open socket is still usable. Called on the
   * reauthorization sweep alongside the post check.
   *
   * A no-op for an anonymous socket: there is no session to invalidate, and
   * calling the token service with a null user would fail closed and disconnect
   * exactly the readers this feature exists to serve.
   */
  async assertSocketSessionValid(
    identity: OrganizationBlogCommentSocketIdentity,
  ): Promise<void> {
    if (!identity.userId) {
      return;
    }

    await this.tokenService.assertSessionIsUsable(
      identity.userId,
      identity.sessionId,
      identity.tokenVersion,
    );
  }

  /** How many sockets are currently watching this post's comments. */
  async countReaders(blogPostId: string): Promise<number> {
    return this.realtimeGateway.countReaders(blogPostId);
  }

  private socketTicketKey(ticket: string): string {
    return `blog-comments:ws-ticket:${ticket}`;
  }

  private editWindowStart(): Date {
    return new Date(Date.now() - BLOG_COMMENT_EDIT_WINDOW_MS);
  }

  /**
   * The public comment surface exists only on a published post. A draft 404s
   * here exactly as it does on the post route itself, so the existence of an
   * unpublished post cannot be probed through its comments.
   */
  private async requirePublishedPost(
    organizationId: string,
    slug: string,
  ): Promise<OrganizationBlogCommentPostContext> {
    const post = await this.repository.findPostForComments(
      organizationId,
      slug,
    );

    if (!post || post.status !== "published") {
      throw new ResourceNotFoundError("Blog post could not be found.");
    }

    return post;
  }

  private assertCommentsOpen(post: OrganizationBlogCommentPostContext): void {
    if (!post.commentsEnabled) {
      throw new ConflictError("Comments are closed on this post.");
    }
  }

  private async requireComment(
    commentId: string,
    blogPostId: string,
  ): Promise<OrganizationBlogCommentRecord> {
    const comment = await this.repository.findById(commentId);

    // The post match matters: without it a comment id from another post would
    // be actionable through any post's route by anyone who manages that post.
    if (!comment || comment.blogPostId !== blogPostId || comment.deletedAt) {
      throw new ResourceNotFoundError("Comment could not be found.");
    }

    return comment;
  }

  /**
   * Whether this viewer manages the owning organization.
   *
   * Returns a plain boolean and never throws. `OrganizationBlogService` has a
   * similar helper that raises `ResourceNotFoundError` for non-members, which
   * is right for a management route and would be catastrophic here: it would
   * 404 every anonymous read of a public page.
   */
  private async resolveCanModerate(
    userId: string | null,
    organizationId: string,
  ): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const membership = await this.organizationAccessService.findMembership(
      userId,
      organizationId,
    );

    if (!membership) {
      return false;
    }

    return this.organizationAccessService.canManage(membership.role);
  }

  private assertSafeBody(body: string): void {
    const violations = this.contentSanitizationService
      .inspect([{ path: "body", value: body }])
      .map((violation) => ({
        path: violation.path,
        message: violation.message,
      }));

    if (violations.length > 0) {
      throw new BadRequestError("Request body validation failed.", violations);
    }
  }

  /**
   * Bounds how fast one account can post, independently of the middleware rate
   * limiter, which keys on IP address. On a public comment form that axis is
   * wrong in both directions: a shared NAT makes strangers share a bucket, and
   * a rotating address evades it entirely.
   */
  private async assertAuthorCooldown(userId: string): Promise<void> {
    const key = `blog-comments:rate:${userId}`;

    try {
      const count = await this.cacheService.increment(key);

      if (count === 1) {
        // Only the first write in a window sets the expiry, so the window is
        // fixed from the first comment rather than sliding forward with every
        // subsequent one — which would never expire under sustained load.
        await this.cacheService.expire(
          key,
          BLOG_COMMENT_AUTHOR_RATE_WINDOW_SECONDS,
        );
      }

      if (count > BLOG_COMMENT_AUTHOR_RATE_LIMIT) {
        throw new ConflictError(
          "You are commenting too quickly. Please wait a moment and try again.",
        );
      }
    } catch (error) {
      if (error instanceof ConflictError) {
        throw error;
      }

      // Redis being unreachable must not close the comment form. The IP-keyed
      // middleware limiter still applies, so failing open here degrades the
      // budget rather than removing every bound.
      this.logger.warn("Failed to apply blog comment author rate limit.", {
        userId,
      });
    }
  }

  private async publishEvent(
    event: OrganizationBlogCommentStreamEvent,
  ): Promise<void> {
    try {
      // Emitted into the post's room; the Socket.IO adapter carries it to
      // sockets held by every other instance.
      this.realtimeGateway.publish(event);
    } catch (error) {
      // Best-effort. The comment is already durably persisted, so a Redis blip
      // must not turn a delivered comment into a 500 that makes the author post
      // it twice.
      this.logger.error(
        "Failed to publish blog comment event.",
        {
          blogPostId: event.blogPostId,
          eventType: event.type,
        },
        error,
      );
    }
  }
}
