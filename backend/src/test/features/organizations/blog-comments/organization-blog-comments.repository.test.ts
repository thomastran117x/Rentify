import { OrganizationBlogCommentsRepository } from "@/features/organizations/blog-comments/organization-blog-comments.repository";

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    blogPostId: "blog-1",
    organizationId: "org-1",
    authorUserId: "user-2",
    author: {
      id: "user-2",
      email: "renter@example.com",
      profile: {
        username: "renter-one",
        avatarUrl: "https://example.test/avatar.png",
      },
    },
    body: "Great post.",
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    ...overrides,
  };
}

function buildPrisma(
  commentMethods: Record<string, jest.Mock> = {},
  postMethods: Record<string, jest.Mock> = {},
) {
  return {
    organizationBlogComment: commentMethods,
    organizationBlogPost: postMethods,
  } as never;
}

describe("OrganizationBlogCommentsRepository", () => {
  describe("findPostForComments", () => {
    it("resolves a post by its organization and slug", async () => {
      const findUnique = jest.fn(async () => ({
        id: "blog-1",
        organizationId: "org-1",
        status: "published",
        commentsEnabled: true,
      }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique }),
      );

      const result = await repository.findPostForComments("org-1", "my-post");

      expect(result).toMatchObject({ id: "blog-1", commentsEnabled: true });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_slug: {
              organizationId: "org-1",
              slug: "my-post",
            },
          },
        }),
      );
    });

    it("returns null when the post does not exist", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique: jest.fn(async () => null) }),
      );

      await expect(
        repository.findPostForComments("org-1", "missing"),
      ).resolves.toBeNull();
    });
  });

  describe("findPostForCommentsById", () => {
    it("resolves the same context by post id", async () => {
      const findUnique = jest.fn(async () => ({
        id: "blog-1",
        organizationId: "org-1",
        status: "published",
        commentsEnabled: false,
      }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique }),
      );

      // The shape the socket handshake holds: it knows a post id, not a slug.
      const result = await repository.findPostForCommentsById("blog-1");

      expect(result).toMatchObject({ commentsEnabled: false });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "blog-1" } }),
      );
    });

    it("returns null for an unknown post id", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique: jest.fn(async () => null) }),
      );

      await expect(
        repository.findPostForCommentsById("missing"),
      ).resolves.toBeNull();
    });
  });

  describe("listByPost", () => {
    it("pages newest-first with a stable tiebreak", async () => {
      const findMany = jest.fn(async () => [buildRow()]);
      const count = jest.fn(async () => 25);
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ findMany, count }),
      );

      const result = await repository.listByPost({
        blogPostId: "blog-1",
        page: 2,
        pageSize: 10,
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          // Newest first so page 1 holds the comments a reader sees; `id`
          // breaks ties so a shared DATETIME(6) cannot duplicate or drop rows.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
      );
      expect(count).toHaveBeenCalledWith({
        where: { blogPostId: "blog-1" },
      });
      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
      expect(result.comments[0]).toMatchObject({
        id: "comment-1",
        author: { id: "user-2", username: "renter-one" },
        deletedBy: null,
      });
    });

    it("reports a single empty page when there are no comments", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          findMany: jest.fn(async () => []),
          count: jest.fn(async () => 0),
        }),
      );

      const result = await repository.listByPost({
        blogPostId: "blog-1",
        page: 1,
        pageSize: 20,
      });

      expect(result.comments).toEqual([]);
      expect(result.pagination).toMatchObject({
        total: 0,
        totalPages: 1,
        hasNextPage: false,
      });
    });
  });

  describe("mapping", () => {
    it("labels an author tombstone", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          findUnique: jest.fn(async () =>
            buildRow({
              body: "",
              deletedAt: new Date("2026-07-17T00:00:00.000Z"),
              deletedByUserId: "user-2",
            }),
          ),
        }),
      );

      const result = await repository.findById("comment-1");

      expect(result).toMatchObject({ body: "", deletedBy: "author" });
    });

    it("labels a moderator tombstone without naming the moderator", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          findUnique: jest.fn(async () =>
            buildRow({
              body: "",
              deletedAt: new Date("2026-07-17T00:00:00.000Z"),
              deletedByUserId: "manager-1",
            }),
          ),
        }),
      );

      const result = await repository.findById("comment-1");

      expect(result).toMatchObject({ deletedBy: "moderator" });
      expect(JSON.stringify(result)).not.toContain("manager-1");
    });

    it("falls back to a label rather than the email when a profile is missing", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          findUnique: jest.fn(async () =>
            buildRow({
              author: {
                id: "user-2",
                email: "renter@example.com",
                profile: null,
              },
            }),
          ),
        }),
      );

      const result = await repository.findById("comment-1");

      expect(result?.author.username).toBe("Member");
      // This record is served on a public page; an address must not leak
      // through a missing profile.
      expect(JSON.stringify(result)).not.toContain("renter@example.com");
    });

    it("returns null for a comment that does not exist", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ findUnique: jest.fn(async () => null) }),
      );

      await expect(repository.findById("missing")).resolves.toBeNull();
    });
  });

  describe("updateBodyIfEligible", () => {
    it("re-asserts authorship, liveness and the window inside the write", async () => {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const findUnique = jest.fn(async () => buildRow({ body: "Edited." }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ updateMany, findUnique }),
      );
      const notBefore = new Date("2026-07-16T00:00:00.000Z");

      const result = await repository.updateBodyIfEligible({
        commentId: "comment-1",
        blogPostId: "blog-1",
        authorUserId: "user-2",
        body: "Edited.",
        editedAt: new Date("2026-07-16T00:05:00.000Z"),
        notBefore,
      });

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "comment-1",
            blogPostId: "blog-1",
            authorUserId: "user-2",
            deletedAt: null,
            createdAt: { gte: notBefore },
          },
        }),
      );
      expect(result).toMatchObject({ body: "Edited." });
    });

    it("returns null when nothing was eligible", async () => {
      const findUnique = jest.fn();
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          updateMany: jest.fn(async () => ({ count: 0 })),
          findUnique,
        }),
      );

      const result = await repository.updateBodyIfEligible({
        commentId: "comment-1",
        blogPostId: "blog-1",
        authorUserId: "user-2",
        body: "Edited.",
        editedAt: new Date(),
        notBefore: new Date(),
      });

      // A PATCH landing after a DELETE must not restore a body while leaving
      // the row tombstoned.
      expect(result).toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe("softDeleteIfEligible", () => {
    it("constrains authorship when the actor is the author", async () => {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          updateMany,
          findUnique: jest.fn(async () => buildRow({ body: "" })),
        }),
      );

      await repository.softDeleteIfEligible({
        commentId: "comment-1",
        blogPostId: "blog-1",
        deletedAt: new Date("2026-07-17T00:00:00.000Z"),
        deletedByUserId: "user-2",
        asModerator: false,
      });

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ authorUserId: "user-2" }),
          data: expect.objectContaining({
            body: "",
            deletedByUserId: "user-2",
          }),
        }),
      );
    });

    it("does not constrain authorship for a moderator", async () => {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          updateMany,
          findUnique: jest.fn(async () => buildRow({ body: "" })),
        }),
      );

      await repository.softDeleteIfEligible({
        commentId: "comment-1",
        blogPostId: "blog-1",
        deletedAt: new Date(),
        deletedByUserId: "manager-1",
        asModerator: true,
      });

      const where = (updateMany as jest.Mock).mock.calls[0][0].where as Record<
        string,
        unknown
      >;
      // A manager must not have to be the author to remove something.
      expect(where).not.toHaveProperty("authorUserId");
      expect(where).toMatchObject({ deletedAt: null });
    });

    it("returns null on a second delete", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          updateMany: jest.fn(async () => ({ count: 0 })),
          findUnique: jest.fn(),
        }),
      );

      const result = await repository.softDeleteIfEligible({
        commentId: "comment-1",
        blogPostId: "blog-1",
        deletedAt: new Date(),
        deletedByUserId: "user-2",
        asModerator: false,
      });

      // Otherwise a repeat would silently rewrite who removed it and when.
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("persists the denormalized organization alongside the post", async () => {
      const create = jest.fn(async () => buildRow());
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ create }),
      );

      const result = await repository.create({
        blogPostId: "blog-1",
        organizationId: "org-1",
        authorUserId: "user-2",
        body: "Great post.",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            blogPostId: "blog-1",
            organizationId: "org-1",
            authorUserId: "user-2",
            body: "Great post.",
          }),
        }),
      );
      expect(result).toMatchObject({ id: "comment-1", deletedAt: null });
    });
  });
});
