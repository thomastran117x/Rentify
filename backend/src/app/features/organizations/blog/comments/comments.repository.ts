import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  OrganizationBlogCommentPagination,
  OrganizationBlogCommentPostContext,
  OrganizationBlogCommentRecord,
} from "@/features/organizations/blog/comments/comments.model";

const AUTHOR_INCLUDE = {
  author: {
    select: {
      id: true,
      email: true,
      profile: {
        select: { username: true, avatarUrl: true },
      },
    },
  },
} as const;

type OrganizationBlogCommentPersistence =
  Prisma.OrganizationBlogCommentGetPayload<{
    include: typeof AUTHOR_INCLUDE;
  }>;

export interface CreateOrganizationBlogCommentPersistence {
  blogPostId: string;
  organizationId: string;
  authorUserId: string;
  body: string;
}

export interface ListOrganizationBlogCommentsPersistenceInput {
  blogPostId: string;
  page: number;
  pageSize: number;
}

export class OrganizationBlogCommentsRepository extends BaseRepository {
  /**
   * Resolves the post a comment route addresses, by the public `(organization,
   * slug)` pair the page already holds.
   *
   * Reaching into `organizationBlogPost` from here rather than borrowing the
   * blog repository follows the precedent of `ReportsRepository`, which reads
   * the subjects it reports on directly: the alternative is a service-level
   * dependency that exists only to run one `findUnique`.
   */
  async findPostForComments(
    organizationId: string,
    slug: string,
  ): Promise<OrganizationBlogCommentPostContext | null> {
    return this.executeAsync(() =>
      this.prisma.organizationBlogPost.findUnique({
        where: { organizationId_slug: { organizationId, slug } },
        select: {
          id: true,
          organizationId: true,
          status: true,
          commentsEnabled: true,
        },
      }),
    );
  }

  /** The same context, by post id — the shape the socket handshake holds. */
  async findPostForCommentsById(
    blogPostId: string,
  ): Promise<OrganizationBlogCommentPostContext | null> {
    return this.executeAsync(() =>
      this.prisma.organizationBlogPost.findUnique({
        where: { id: blogPostId },
        select: {
          id: true,
          organizationId: true,
          status: true,
          commentsEnabled: true,
        },
      }),
    );
  }

  async listByPost(
    input: ListOrganizationBlogCommentsPersistenceInput,
  ): Promise<{
    comments: OrganizationBlogCommentRecord[];
    pagination: OrganizationBlogCommentPagination;
  }> {
    const where: Prisma.OrganizationBlogCommentWhereInput = {
      blogPostId: input.blogPostId,
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.organizationBlogComment.findMany({
          where,
          skip,
          take: input.pageSize,
          // Newest first, so page 1 holds the comments a reader actually sees
          // and paging walks backwards into history. A comment section renders
          // oldest-to-newest, but ordering the *pages* that way would put the
          // newest comments on the last page — a thread past one page would
          // then show its oldest 50 and hide every recent reply.
          //
          // `id` breaks ties, because two comments can share a DATETIME(6)
          // value and an unstable sort would duplicate or drop rows across
          // pages.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: AUTHOR_INCLUDE,
        }),
        this.prisma.organizationBlogComment.count({ where }),
      ]),
    );

    return {
      comments: rows.map((row) => this.mapComment(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
    };
  }

  /**
   * Inserts a comment only if the post is still open to them, returning null
   * when it is not.
   *
   * The service already checked, but that check and this write are separated by
   * a rate-limit round trip, and a manager can close comments in between. The
   * post row is re-read `FOR UPDATE` inside the transaction rather than with a
   * plain read: InnoDB's default REPEATABLE READ would serve the snapshot from
   * the transaction's start, which is exactly the stale value being guarded
   * against. A locking read sees the latest committed row and blocks a
   * concurrent close until this insert commits.
   */
  async createIfCommentsOpen(
    input: CreateOrganizationBlogCommentPersistence,
  ): Promise<OrganizationBlogCommentRecord | null> {
    const created = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        if (!(await this.isPostOpenForWrites(transaction, input.blogPostId))) {
          return null;
        }

        return transaction.organizationBlogComment.create({
          data: {
            id: randomUUID(),
            blogPostId: input.blogPostId,
            organizationId: input.organizationId,
            authorUserId: input.authorUserId,
            body: input.body,
          },
          include: AUTHOR_INCLUDE,
        });
      }),
    );

    return created ? this.mapComment(created) : null;
  }

  async findById(
    commentId: string,
  ): Promise<OrganizationBlogCommentRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogComment.findUnique({
        where: { id: commentId },
        include: AUTHOR_INCLUDE,
      }),
    );

    return row ? this.mapComment(row) : null;
  }

  /**
   * Editing is the author's own act, inside a fixed window, on a live comment.
   *
   * Eligibility is re-asserted inside the write so concurrent requests cannot
   * both pass an earlier check: without it a PATCH landing after a DELETE would
   * restore a body while leaving `deletedAt` set.
   */
  async updateBodyIfEligible(input: {
    commentId: string;
    blogPostId: string;
    authorUserId: string;
    body: string;
    editedAt: Date;
    notBefore: Date;
  }): Promise<OrganizationBlogCommentRecord | null> {
    const updated = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        // The same locking re-read the insert does, for the same reason: the
        // service checked the thread was open, and a manager can close it
        // before this write lands. Editing a comment on a closed thread would
        // otherwise succeed while the API told everyone else it was closed.
        if (!(await this.isPostOpenForWrites(transaction, input.blogPostId))) {
          return null;
        }

        const result = await transaction.organizationBlogComment.updateMany({
          where: {
            id: input.commentId,
            blogPostId: input.blogPostId,
            authorUserId: input.authorUserId,
            deletedAt: null,
            createdAt: { gte: input.notBefore },
          },
          data: { body: input.body, editedAt: input.editedAt },
        });

        return result.count === 0 ? null : true;
      }),
    );

    if (!updated) {
      return null;
    }

    return this.findById(input.commentId);
  }

  /**
   * Locking re-read of the post a write is about to touch.
   *
   * `FOR UPDATE` rather than a plain select: InnoDB's default REPEATABLE READ
   * would serve the snapshot from the transaction's start, which is exactly the
   * stale value being guarded against. A locking read sees the latest committed
   * row and blocks a concurrent close until this transaction commits.
   */
  private async isPostOpenForWrites(
    transaction: Pick<typeof this.prisma, "$queryRaw">,
    blogPostId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<
      Array<{ status: string; comments_enabled: number | boolean }>
    >(
      Prisma.sql`
        SELECT status, comments_enabled
        FROM organization_blog_posts
        WHERE id = ${blogPostId}
        FOR UPDATE
      `,
    );
    const post = rows[0];

    return Boolean(
      post && post.status === "published" && post.comments_enabled,
    );
  }

  /**
   * Soft-deletes a comment, either as its author or as a manager of the owning
   * organization. `authorUserId` is only constrained in the author case, which
   * is what keeps a manager from having to be the author to remove something.
   *
   * `deletedAt: null` in the `where` is what makes a second DELETE return null
   * rather than silently rewriting the tombstone's timestamp and attribution.
   */
  async softDeleteIfEligible(input: {
    commentId: string;
    blogPostId: string;
    deletedAt: Date;
    deletedByUserId: string;
    asModerator: boolean;
  }): Promise<OrganizationBlogCommentRecord | null> {
    const where: Prisma.OrganizationBlogCommentWhereInput = {
      id: input.commentId,
      blogPostId: input.blogPostId,
      deletedAt: null,
      ...(input.asModerator ? {} : { authorUserId: input.deletedByUserId }),
    };

    const result = await this.executeAsync(() =>
      this.prisma.organizationBlogComment.updateMany({
        where,
        // The row survives so the list keeps its shape and any content report
        // pointing at this comment still resolves; only the text is removed.
        data: {
          body: "",
          deletedAt: input.deletedAt,
          deletedByUserId: input.deletedByUserId,
        },
      }),
    );

    if (result.count === 0) {
      return null;
    }

    return this.findById(input.commentId);
  }

  private mapComment(
    row: OrganizationBlogCommentPersistence,
  ): OrganizationBlogCommentRecord {
    return {
      id: row.id,
      blogPostId: row.blogPostId,
      organizationId: row.organizationId,
      author: {
        id: row.authorUserId,
        // Falls back to a label, never to the email: this record is served on a
        // public page, so an address must not leak through a missing profile.
        username: row.author?.profile?.username ?? "Member",
        avatarUrl: row.author?.profile?.avatarUrl ?? undefined,
      },
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      deletedBy: this.resolveDeletedBy(row),
    };
  }

  /**
   * Collapses the deleting user id to the only distinction a reader needs.
   * Naming the manager who removed a comment on a public page would expose
   * staff to the person they moderated.
   */
  private resolveDeletedBy(
    row: OrganizationBlogCommentPersistence,
  ): "author" | "moderator" | null {
    if (!row.deletedAt) {
      return null;
    }

    return row.deletedByUserId === row.authorUserId ? "author" : "moderator";
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): OrganizationBlogCommentPagination {
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
