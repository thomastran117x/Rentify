import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import {
  htmlToPlainText,
  sanitizeRichText,
} from "@/configuration/security/html-sanitizer";
import type { BlobService } from "@/features/blob/blob.service";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationBlogRepository } from "@/features/organizations/organization-blog.repository";
import type {
  CreateOrganizationBlogPostInput,
  DeleteOrganizationBlogPostInput,
  DeleteOrganizationBlogPostResult,
  GetPublicOrganizationBlogPostInput,
  ListOrganizationBlogPostsInput,
  ListOrganizationBlogPostsResult,
  ListPublicOrganizationBlogPostsInput,
  OrganizationBlogPostRecord,
  OrganizationBlogStatus,
  UpdateOrganizationBlogPostInput,
} from "@/features/organizations/organization-blog.model";
import type { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import {
  createAuditChanges,
  type CreateOrganizationAuditLogInput,
  type OrganizationAuditAction,
} from "@/features/organizations/organization-audit.model";

const ORGANIZATION_BLOB_PREFIX = "organizations/";
const MAX_SLUG_ATTEMPTS = 50;

export class OrganizationBlogService {
  private readonly logger = loggerFactory.forClass(
    OrganizationBlogService,
    "service",
  );

  constructor(
    private readonly repository: OrganizationBlogRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationAuditService: OrganizationAuditService,
    private readonly blobService: BlobService,
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
      status: input.status,
      tag: input.tag,
      ...(canManage ? {} : { statuses: ["published"] }),
    });
  }

  async listPublished(
    input: ListPublicOrganizationBlogPostsInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    return this.repository.list({
      organizationId: input.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      statuses: ["published"],
      tag: input.tag,
    });
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
    this.assertBlogCoverImageInput(
      input.actorUserId,
      input.coverImageUrl,
      input.coverImageBlobName,
    );

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
      coverImageUrl: input.coverImageUrl ?? null,
      coverImageBlobName: input.coverImageBlobName ?? null,
      tags: input.tags ?? [],
      status: input.status,
      publishedAt: input.status === "published" ? new Date() : null,
    });

    // TODO(search): enqueue an OrganizationSearchOutbox "upsert" here when blog
    // posts are added to Elasticsearch (mirror organizations.repository).
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
    this.assertBlogCoverImageInput(
      input.actorUserId,
      input.coverImageUrl,
      input.coverImageBlobName,
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
        coverImageUrl: input.coverImageUrl,
        coverImageBlobName: input.coverImageBlobName,
        tags: input.tags,
        status: input.status,
        publishedAt,
      },
    );

    await this.cleanupReplacedCoverImage(input.actorUserId, existing, updated);

    // TODO(search): enqueue an OrganizationSearchOutbox "upsert"/"delete" here
    // (delete when unpublished) once blog posts are indexed in Elasticsearch.
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

    // TODO(search): enqueue an OrganizationSearchOutbox "delete" here when blog
    // posts are indexed in Elasticsearch.
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
    organizationId: string,
    source: string,
    excludeBlogPostId?: string,
  ): Promise<string> {
    const base = this.slugify(source);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await this.repository.findBySlug(
        organizationId,
        candidate,
      );

      if (!existing || existing.id === excludeBlogPostId) {
        return candidate;
      }
    }

    // Extremely unlikely; fall back to a suffix that is effectively unique.
    return `${base}-${Date.now().toString(36)}`;
  }

  private slugify(source: string): string {
    const slug = source
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 200)
      .replace(/-+$/g, "");

    return slug || "post";
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
      publishedAt: post.publishedAt ?? null,
    };
  }

  private async requireBlogPost(
    organizationId: string,
    blogPostId: string,
  ): Promise<OrganizationBlogPostRecord> {
    const post = await this.repository.findById(organizationId, blogPostId);

    if (!post) {
      throw new ResourceNotFoundError("Blog post could not be found.");
    }

    return post;
  }

  private async resolveCanManage(
    actorUserId: string,
    organizationId: string,
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
    actorUserId: string,
    organizationId: string,
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

  private assertBlogCoverImageInput(
    actorUserId: string,
    coverImageUrl: string | null | undefined,
    coverImageBlobName: string | null | undefined,
  ): void {
    const hasUrl = coverImageUrl !== undefined;
    const hasBlobName = coverImageBlobName !== undefined;

    if (hasUrl !== hasBlobName) {
      throw new BadRequestError(
        "Cover image URL and blob name must be provided together.",
      );
    }

    if (!hasUrl && !hasBlobName) {
      return;
    }

    if (!coverImageUrl && !coverImageBlobName) {
      return;
    }

    if (!coverImageUrl || !coverImageBlobName) {
      throw new BadRequestError(
        "Cover image URL and blob name must both be set or both be null.",
      );
    }

    const blobName = coverImageBlobName.trim();

    if (!this.isOrganizationBlobName(blobName)) {
      throw new BadRequestError(
        "Cover images must use an organizations-scoped blob.",
      );
    }

    if (!this.blobService.isConfigured()) {
      throw new BadRequestError(
        "Cover images require Blob Storage to be configured on the backend.",
      );
    }

    if (!this.blobService.isManagedBlobUrl(coverImageUrl, blobName)) {
      throw new BadRequestError(
        "Cover image URL must match the Blob Storage location for the provided blob name.",
      );
    }

    if (!this.blobService.isBlobOwnedByUser(actorUserId, blobName)) {
      throw new BadRequestError(
        "Cover image blob must belong to the current user.",
      );
    }
  }

  private async cleanupReplacedCoverImage(
    actorUserId: string,
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
    actorUserId: string,
    blobName: string | null | undefined,
    blobUrl?: string,
  ): Promise<void> {
    if (
      !blobName ||
      !this.isOrganizationBlobName(blobName) ||
      !this.blobService.isBlobOwnedByUser(actorUserId, blobName) ||
      (blobUrl && !this.blobService.isManagedBlobUrl(blobUrl, blobName))
    ) {
      return;
    }

    try {
      await this.blobService.deleteBlob(blobName);
    } catch (error) {
      this.logger.error("Failed to delete replaced blog cover image blob.", {
        blobName,
        error,
      });
    }
  }

  private isOrganizationBlobName(blobName: string): boolean {
    return blobName.trim().toLowerCase().startsWith(ORGANIZATION_BLOB_PREFIX);
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
