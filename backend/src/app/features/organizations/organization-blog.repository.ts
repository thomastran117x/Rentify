import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  CreateOrganizationBlogPostPersistence,
  ListOrganizationBlogPostsResult,
  OrganizationBlogPostRecord,
  OrganizationBlogStatus,
  UpdateOrganizationBlogPostPersistence,
} from "@/features/organizations/organization-blog.model";

type BlogPostPersistence = Prisma.OrganizationBlogPostGetPayload<{
  include: {
    author: {
      include: {
        profile: true;
      };
    };
  };
}>;

export interface ListOrganizationBlogPostsQueryInput {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: OrganizationBlogStatus;
  statuses?: OrganizationBlogStatus[];
  tag?: string;
}

export class OrganizationBlogRepository extends BaseRepository {
  async create(
    input: CreateOrganizationBlogPostPersistence,
  ): Promise<OrganizationBlogPostRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          authorUserId: input.authorUserId,
          title: input.title,
          slug: input.slug,
          excerpt: input.excerpt,
          body: input.body,
          coverImageUrl: input.coverImageUrl,
          coverImageBlobName: input.coverImageBlobName,
          tags: input.tags,
          status: input.status,
          publishedAt: input.publishedAt,
        },
        include: this.includeAuthor(),
      }),
    );

    return this.mapBlogPost(row);
  }

  async update(
    organizationId: string,
    blogPostId: string,
    input: UpdateOrganizationBlogPostPersistence,
  ): Promise<OrganizationBlogPostRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.update({
        where: { id: blogPostId, organizationId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.coverImageUrl !== undefined
            ? { coverImageUrl: input.coverImageUrl }
            : {}),
          ...(input.coverImageBlobName !== undefined
            ? { coverImageBlobName: input.coverImageBlobName }
            : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.publishedAt !== undefined
            ? { publishedAt: input.publishedAt }
            : {}),
        },
        include: this.includeAuthor(),
      }),
    );

    return this.mapBlogPost(row);
  }

  async delete(organizationId: string, blogPostId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationBlogPost.delete({
        where: { id: blogPostId, organizationId },
      }),
    );
  }

  async findById(
    organizationId: string,
    blogPostId: string,
  ): Promise<OrganizationBlogPostRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findFirst({
        where: { id: blogPostId, organizationId },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapBlogPost(row) : null;
  }

  async findBySlug(
    organizationId: string,
    slug: string,
  ): Promise<OrganizationBlogPostRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findFirst({
        where: { organizationId, slug },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapBlogPost(row) : null;
  }

  async findPublishedBySlug(
    organizationId: string,
    slug: string,
  ): Promise<OrganizationBlogPostRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findFirst({
        where: { organizationId, slug, status: "published" },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapBlogPost(row) : null;
  }

  async list(
    input: ListOrganizationBlogPostsQueryInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    const statusFilter = input.status
      ? [input.status]
      : (input.statuses ?? undefined);
    const publishedOnly =
      statusFilter?.length === 1 && statusFilter[0] === "published";
    const where: Prisma.OrganizationBlogPostWhereInput = {
      organizationId: input.organizationId,
      ...(statusFilter ? { status: { in: statusFilter } } : {}),
      ...(input.tag ? { tags: { array_contains: input.tag } } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.organizationBlogPost.findMany({
          where,
          skip,
          take: input.pageSize,
          // Published feeds read best ordered by publish date; drafts have none,
          // so fall back to creation order for management/mixed listings.
          orderBy: publishedOnly
            ? [{ publishedAt: "desc" }, { createdAt: "desc" }]
            : { createdAt: "desc" },
          include: this.includeAuthor(),
        }),
        this.prisma.organizationBlogPost.count({ where }),
      ]),
    );

    return {
      posts: rows.map((row) => this.mapBlogPost(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
    };
  }

  private includeAuthor() {
    return {
      author: {
        include: {
          profile: true,
        },
      },
    } satisfies Prisma.OrganizationBlogPostInclude;
  }

  private mapBlogPost(row: BlogPostPersistence): OrganizationBlogPostRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      author: row.author
        ? {
            id: row.author.id,
            email: row.author.email,
            username: row.author.profile?.username ?? row.author.email,
            avatarUrl: row.author.profile?.avatarUrl ?? undefined,
          }
        : undefined,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt ?? undefined,
      body: row.body,
      coverImageUrl: row.coverImageUrl ?? undefined,
      coverImageBlobName: row.coverImageBlobName ?? undefined,
      tags: this.parseTags(row.tags),
      status: row.status as OrganizationBlogStatus,
      publishedAt: row.publishedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private parseTags(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is string => typeof entry === "string");
  }

  private createPagination(page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
