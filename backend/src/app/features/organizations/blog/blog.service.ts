import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import {
  htmlToPlainText,
  sanitizeRichText,
} from "@/configuration/security/html-sanitizer";
import type { MediaService } from "@/features/media/media.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationBlogRepository } from "@/features/organizations/blog/blog.repository";
import type { OrganizationBlogPublicSearchService } from "@/features/organizations/blog/search/public-search.service";
import type { OrganizationBlogCommentRealtimeGateway } from "@/features/organizations/blog/comments/comments.service";
import type {
  CreateOrganizationBlogPostInput,
  DeleteOrganizationBlogPostInput,
  DeleteOrganizationBlogPostResult,
  GetPublicOrganizationBlogPostInput,
  ListOrganizationBlogPostsInput,
  ListOrganizationBlogPostsResult,
  ListPublicBlogFeedInput,
  ListPublicOrganizationBlogPostsInput,
  OrganizationBlogPostRecord,
  OrganizationBlogStatus,
  UpdateOrganizationBlogPostInput,
} from "@/features/organizations/blog/blog.model";
import {
  resolveUniqueSlug,
  slugify,
  withSuffix,
} from "@/features/organizations/organization-slug";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import {
  createAuditChanges,
  type CreateOrganizationAuditLogInput,
  type OrganizationAuditAction,
} from "@/features/organizations/audit/audit.model";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

const MAX_SLUG_ATTEMPTS = 50;
// Matches OrganizationBlogPost.slug in the Prisma schema.
const BLOG_SLUG_MAX_LENGTH = 200;

// Covers stored before media records existed were named under this prefix.
const LEGACY_COVER_BLOB_PREFIX = "organizations/";

const COVER_IMAGE_FIELDS = {
  mediaId: "coverImageMediaId",
  url: "coverImageUrl",
  blobName: "coverImageBlobName",
} as const;

export class OrganizationBlogService {
  private readonly logger = loggerFactory.forClass(
    OrganizationBlogService,
    "service",
  );

  constructor(
    private readonly repository: OrganizationBlogRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly mediaService: MediaService,
    private readonly publicSearchService: OrganizationBlogPublicSearchService,
    private readonly blogCommentRealtimeGateway: OrganizationBlogCommentRealtimeGateway,
  ) {}

  async list(
    input: ListOrganizationBlogPostsInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    const canManage = await this.resolveCanManage(
      input.actorUserId,
      input.organizationId,
    );

    return this.repository.list({
      organizationId: input.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      tag: input.tag,
      // Non-managers are restricted to published posts. Crucially, we must NOT
      // forward their requested `status` filter — the repository gives `status`
      // precedence over `statuses`, so a `?status=draft` query would otherwise
      // bypass the published-only scope.
      ...(canManage ? { status: input.status } : { statuses: ["published"] }),
    });
  }

  async listPublished(
    input: ListPublicOrganizationBlogPostsInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    // Elasticsearch-backed (published only), with a transparent database
    // fallback when the cluster is unavailable.
    return this.publicSearchService.searchByOrganization(input);
  }

  async searchGlobal(
    input: ListPublicBlogFeedInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    // Cross-organization published blog feed/search.
    return this.publicSearchService.searchGlobal(input);
  }

  async getPublishedBySlug(
    input: GetPublicOrganizationBlogPostInput,
  ): Promise<OrganizationBlogPostRecord> {
    const post = await this.repository.findPublishedBySlug(
      input.organizationId,
      input.slug,
    );

    if (!post) {
      throw new ResourceNotFoundError("Blog post could not be found.");
    }

    return post;
  }

  async create(
    input: CreateOrganizationBlogPostInput,
  ): Promise<OrganizationBlogPostRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const cover = await this.resolveBlogCoverImage(input, null);

    const body = sanitizeRichText(input.body);
    this.assertBodyNotEmpty(body);
    const slug = await this.resolveUniqueSlug(
      input.organizationId,
      input.slug ?? input.title,
    );

    const post = await this.repository.create({
      organizationId: input.organizationId,
      authorUserId: input.actorUserId,
      title: input.title,
      slug,
      excerpt: this.resolveExcerpt(input.excerpt, body),
      body,
      coverImageUrl: cover.coverImageUrl ?? null,
      coverImageBlobName: cover.coverImageBlobName ?? null,
      tags: input.tags ?? [],
      status: input.status,
      commentsEnabled: input.commentsEnabled ?? true,
      publishedAt: input.status === "published" ? new Date() : null,
    });

    // The Elasticsearch upsert is enqueued transactionally in the repository
    // (OrganizationBlogRepository.create) so indexing can never diverge from the
    // committed write.
    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "blog.created",
      resourceType: "blog",
      resourceId: post.id,
      summary: `Created blog post "${post.title}".`,
      afterSnapshot: this.toSnapshot(post),
    });

    return post;
  }

  async update(
    input: UpdateOrganizationBlogPostInput,
  ): Promise<OrganizationBlogPostRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const existing = await this.requireBlogPost(
      input.organizationId,
      input.blogPostId,
    );
    const cover = await this.resolveBlogCoverImage(
      input,
      existing.coverImageBlobName ?? null,
    );

    const body =
      input.body !== undefined ? sanitizeRichText(input.body) : undefined;
    if (body !== undefined) {
      this.assertBodyNotEmpty(body);
    }

    // Only regenerate the slug when explicitly requested; keeping it stable
    // avoids breaking public links when a published post is edited.
    let slug: string | undefined;
    if (input.slug !== undefined && input.slug !== existing.slug) {
      slug = await this.resolveUniqueSlug(
        input.organizationId,
        input.slug,
        existing.id,
      );
    }

    const nextStatus = input.status ?? existing.status;
    const publishedAt =
      nextStatus === existing.status
        ? undefined
        : nextStatus === "published"
          ? new Date()
          : null;

    const excerpt =
      input.excerpt !== undefined
        ? input.excerpt === null
          ? null
          : this.resolveExcerpt(input.excerpt, body ?? existing.body)
        : undefined;

    const updated = await this.repository.update(
      input.organizationId,
      input.blogPostId,
      {
        title: input.title,
        slug,
        excerpt,
        body,
        coverImageUrl: cover.coverImageUrl,
        coverImageBlobName: cover.coverImageBlobName,
        tags: input.tags,
        status: input.status,
        commentsEnabled: input.commentsEnabled,
        publishedAt,
      },
    );

    // Only when the value actually moved. A manager saving an unrelated edit
    // must not tell every open page to re-evaluate its composer, and a client
    // that hears "closed" for a thread that was already closed would flicker.
    //
    // Best-effort, like every other publish in this feature: the update has
    // already committed, and the cover-image cleanup and audit record below
    // have not run yet. Letting a Redis or gateway fault escape here would turn
    // a persisted change into a 500, orphan the replaced cover image, and skip
    // the audit trail for something that did happen.
    if (existing.commentsEnabled !== updated.commentsEnabled) {
      try {
        this.blogCommentRealtimeGateway.publish({
          type: "comments.closed",
          blogPostId: asUuid(updated.id),
          commentsEnabled: updated.commentsEnabled,
        });
      } catch (error) {
        this.logger.error(
          "Failed to publish a blog comment availability change.",
          {
            blogPostId: updated.id,
            commentsEnabled: updated.commentsEnabled,
          },
          error,
        );
      }
    }

    await this.cleanupReplacedCoverImage(input.actorUserId, existing, updated);

    // The Elasticsearch upsert is enqueued transactionally in the repository
    // (OrganizationBlogRepository.update). Drafts stay indexed with their status,
    // so an unpublish is just an upsert the public queries filter out.
    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: this.resolveUpdateAction(existing.status, updated.status),
      resourceType: "blog",
      resourceId: updated.id,
      summary: `Updated blog post "${updated.title}".`,
      changes: createAuditChanges(
        this.toSnapshot(existing),
        this.toSnapshot(updated),
      ),
      beforeSnapshot: this.toSnapshot(existing),
      afterSnapshot: this.toSnapshot(updated),
    });

    return updated;
  }

  async delete(
    input: DeleteOrganizationBlogPostInput,
  ): Promise<DeleteOrganizationBlogPostResult> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const existing = await this.requireBlogPost(
      input.organizationId,
      input.blogPostId,
    );

    await this.repository.delete(input.organizationId, input.blogPostId);
    await this.cleanupCoverImage(
      input.actorUserId,
      existing.coverImageBlobName,
    );

    // The Elasticsearch delete is enqueued transactionally in the repository
    // (OrganizationBlogRepository.delete) so the document is removed from the
    // index even though the source row is gone.
    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "blog.deleted",
      resourceType: "blog",
      resourceId: existing.id,
      summary: `Deleted blog post "${existing.title}".`,
      beforeSnapshot: this.toSnapshot(existing),
    });

    return { deleted: true, blogPostId: input.blogPostId };
  }

  private resolveUpdateAction(
    previousStatus: OrganizationBlogStatus,
    nextStatus: OrganizationBlogStatus,
  ): OrganizationAuditAction {
    if (previousStatus !== nextStatus && nextStatus === "published") {
      return "blog.published";
    }

    if (previousStatus !== nextStatus && nextStatus === "draft") {
      return "blog.unpublished";
    }

    return "blog.updated";
  }

  private resolveExcerpt(
    excerpt: string | null | undefined,
    body: string,
  ): string | null {
    const trimmed = excerpt?.trim();
    if (trimmed) {
      return trimmed;
    }

    const plain = htmlToPlainText(body);
    if (!plain) {
      return null;
    }

    return plain.length > 300 ? `${plain.slice(0, 297).trimEnd()}...` : plain;
  }

  private async resolveUniqueSlug(
    organizationId: Uuid,
    source: string,
    excludeBlogPostId?: string,
  ): Promise<string> {
    return resolveUniqueSlug(
      this.slugify(source),
      async (candidate) => {
        const existing = await this.repository.findBySlug(
          organizationId,
          candidate,
        );

        return Boolean(existing) && existing?.id !== excludeBlogPostId;
      },
      {
        maxLength: BLOG_SLUG_MAX_LENGTH,
        maxAttempts: MAX_SLUG_ATTEMPTS,
        // Extremely unlikely; fall back to a suffix that is effectively unique.
        buildFallback: (base) =>
          withSuffix(base, `-${Date.now().toString(36)}`, BLOG_SLUG_MAX_LENGTH),
      },
    );
  }

  private slugify(source: string): string {
    return slugify(source, {
      maxLength: BLOG_SLUG_MAX_LENGTH,
      fallback: "post",
    });
  }

  private assertBodyNotEmpty(body: string): void {
    if (htmlToPlainText(body).length === 0) {
      throw new BadRequestError("Body is required.");
    }
  }

  private toSnapshot(
    post: OrganizationBlogPostRecord,
  ): Record<string, unknown> {
    return {
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt ?? null,
      body: post.body,
      coverImageUrl: post.coverImageUrl ?? null,
      coverImageBlobName: post.coverImageBlobName ?? null,
      tags: post.tags,
      status: post.status,
      commentsEnabled: post.commentsEnabled,
      publishedAt: post.publishedAt ?? null,
    };
  }

  private async requireBlogPost(
    organizationId: Uuid,
    blogPostId: Uuid,
  ): Promise<OrganizationBlogPostRecord> {
    const post = await this.repository.findById(organizationId, blogPostId);

    if (!post) {
      throw new ResourceNotFoundError("Blog post could not be found.");
    }

    return post;
  }

  private async resolveCanManage(
    actorUserId: Uuid,
    organizationId: Uuid,
  ): Promise<boolean> {
    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return this.organizationAccessService.canManage(membership.role);
  }

  private async requireManager(
    actorUserId: Uuid,
    organizationId: Uuid,
  ): Promise<void> {
    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (!this.organizationAccessService.canManage(membership.role)) {
      throw new ForbiddenError(
        "Only organization managers can manage blog posts.",
      );
    }
  }

  /**
   * Applies MediaService's image rule to the cover image fields of a blog write
   * and returns the values to store; both are undefined when the write left
   * the cover alone.
   */
  private async resolveBlogCoverImage(
    input: {
      actorUserId: Uuid;
      coverImageMediaId?: Uuid;
      coverImageUrl?: string | null;
      coverImageBlobName?: string | null;
    },
    currentBlobName: string | null,
  ): Promise<{
    coverImageUrl?: string | null;
    coverImageBlobName?: string | null;
  }> {
    const cover = await this.mediaService.resolveImageReference(
      input.actorUserId,
      {
        mediaId: input.coverImageMediaId,
        url: input.coverImageUrl,
        blobName: input.coverImageBlobName,
      },
      {
        scope: "organizations",
        storedBlobNames: new Set(currentBlobName ? [currentBlobName] : []),
        fields: COVER_IMAGE_FIELDS,
      },
    );

    if (cover === undefined) {
      return {};
    }

    return {
      coverImageUrl: cover?.blobUrl ?? null,
      coverImageBlobName: cover?.blobName ?? null,
    };
  }

  private async cleanupReplacedCoverImage(
    actorUserId: Uuid,
    before: OrganizationBlogPostRecord,
    after: OrganizationBlogPostRecord,
  ): Promise<void> {
    const previousBlobName = before.coverImageBlobName ?? null;

    if (!previousBlobName || previousBlobName === after.coverImageBlobName) {
      return;
    }

    await this.cleanupCoverImage(
      actorUserId,
      previousBlobName,
      before.coverImageUrl,
    );
  }

  private async cleanupCoverImage(
    actorUserId: Uuid,
    blobName: string | null | undefined,
    blobUrl?: string,
  ): Promise<void> {
    if (
      !blobName ||
      !this.isOrganizationBlobName(blobName) ||
      !this.mediaService.isOwnedBy(actorUserId, blobName) ||
      (blobUrl && !this.mediaService.isManagedUrl(blobUrl, blobName))
    ) {
      return;
    }

    try {
      await this.mediaService.deleteReplacedImageByBlobName(
        actorUserId,
        blobName,
      );
    } catch (error) {
      this.logger.error("Failed to delete replaced blog cover image blob.", {
        blobName,
        error,
      });
    }
  }

  private isOrganizationBlobName(blobName: string): boolean {
    const normalized = blobName.trim();

    return (
      normalized.toLowerCase().startsWith(LEGACY_COVER_BLOB_PREFIX) ||
      this.mediaService.isProcessedImageBlobName(normalized)
    );
  }

  private async recordAuditSafely(
    input: CreateOrganizationAuditLogInput,
  ): Promise<void> {
    try {
      await this.organizationAuditService.record(input);
    } catch (error) {
      this.logger.error("Failed to record organization audit entry.", {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? undefined,
        error,
      });
    }
  }
}
