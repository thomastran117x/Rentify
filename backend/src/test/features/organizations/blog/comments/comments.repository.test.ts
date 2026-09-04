import { OrganizationBlogCommentsRepository } from "@/features/organizations/blog/comments/comments.repository";
import { testUuid } from "../../../../support/uuid";
const COMMENT_1_ID = testUuid(9000, 73688);
const MANAGER_1_ID = testUuid(9000, 836503);
const MISSING_ID = testUuid(9000, 394917);

const BLOG_1_ID = testUuid(9000, 853730);
const ORG_1_ID = testUuid(9000, 9234);
const USER_2_ID = testUuid(9000, 994258);

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_1_ID,
    blogPostId: BLOG_1_ID,
    organizationId: ORG_1_ID,
    authorUserId: USER_2_ID,
    author: {
      id: USER_2_ID,
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
  options: { lockedPost?: unknown } = {},
) {
  const client: Record<string, unknown> = {
    organizationBlogComment: commentMethods,
    organizationBlogPost: postMethods,
    // The locking re-read of the post row. Defaults to an open, published post
    // so the common path needs no setup.
    $queryRaw: jest.fn(async () =>
      options.lockedPost === undefined
        ? [{ status: "published", comments_enabled: 1 }]
        : options.lockedPost === null
          ? []
          : [options.lockedPost],
    ),
  };
  client.$transaction = jest.fn(
    async (run: (tx: typeof client) => Promise<unknown>) => run(client),
  );

  return client as never;
}

describe("OrganizationBlogCommentsRepository", () => {
  describe("findPostForComments", () => {
    it("resolves a post by its organization and slug", async () => {
      const findUnique = jest.fn(async () => ({
        id: BLOG_1_ID,
        organizationId: ORG_1_ID,
        status: "published",
        commentsEnabled: true,
      }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique }),
      );

      const result = await repository.findPostForComments(ORG_1_ID, "my-post");

      expect(result).toMatchObject({ id: BLOG_1_ID, commentsEnabled: true });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_slug: {
              organizationId: ORG_1_ID,
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
        repository.findPostForComments(ORG_1_ID, MISSING_ID),
      ).resolves.toBeNull();
    });
  });

  describe("findPostForCommentsById", () => {
    it("resolves the same context by post id", async () => {
      const findUnique = jest.fn(async () => ({
        id: BLOG_1_ID,
        organizationId: ORG_1_ID,
        status: "published",
        commentsEnabled: false,
      }));
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique }),
      );

      // The shape the socket handshake holds: it knows a post id, not a slug.
      const result = await repository.findPostForCommentsById(BLOG_1_ID);

      expect(result).toMatchObject({ commentsEnabled: false });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BLOG_1_ID } }),
      );
    });

    it("returns null for an unknown post id", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({}, { findUnique: jest.fn(async () => null) }),
      );

      await expect(
        repository.findPostForCommentsById(MISSING_ID),
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
        blogPostId: BLOG_1_ID,
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
        where: { blogPostId: BLOG_1_ID },
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
        id: COMMENT_1_ID,
        author: { id: USER_2_ID, username: "renter-one" },
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
        blogPostId: BLOG_1_ID,
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
              deletedByUserId: USER_2_ID,
            }),
          ),
        }),
      );

      const result = await repository.findById(COMMENT_1_ID);

      expect(result).toMatchObject({ body: "", deletedBy: "author" });
    });

    it("labels a moderator tombstone without naming the moderator", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          findUnique: jest.fn(async () =>
            buildRow({
              body: "",
              deletedAt: new Date("2026-07-17T00:00:00.000Z"),
              deletedByUserId: MANAGER_1_ID,
            }),
          ),
        }),
      );

      const result = await repository.findById(COMMENT_1_ID);

      expect(result).toMatchObject({ deletedBy: "moderator" });
      expect(JSON.stringify(result)).not.toContain(MANAGER_1_ID);
    });

    it("falls back to a label rather than the email when a profile is missing", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({
          findUnique: jest.fn(async () =>
            buildRow({
              author: {
                id: USER_2_ID,
                email: "renter@example.com",
                profile: null,
              },
            }),
          ),
        }),
      );

      const result = await repository.findById(COMMENT_1_ID);

      expect(result?.author.username).toBe("Member");
      // This record is served on a public page; an address must not leak
      // through a missing profile.
      expect(JSON.stringify(result)).not.toContain("renter@example.com");
    });

    it("returns null for a comment that does not exist", async () => {
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ findUnique: jest.fn(async () => null) }),
      );

      await expect(repository.findById(MISSING_ID)).resolves.toBeNull();
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
        commentId: COMMENT_1_ID,
        blogPostId: BLOG_1_ID,
        authorUserId: USER_2_ID,
        body: "Edited.",
        editedAt: new Date("2026-07-16T00:05:00.000Z"),
        notBefore,
      });

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: COMMENT_1_ID,
            blogPostId: BLOG_1_ID,
            authorUserId: USER_2_ID,
            deletedAt: null,
            createdAt: { gte: notBefore },
          },
        }),
      );
      expect(result).toMatchObject({ body: "Edited." });
    });

    it("refuses to edit once comments were closed", async () => {
      const updateMany = jest.fn();
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma(
          { updateMany, findUnique: jest.fn() },
          {},
          {
            lockedPost: { status: "published", comments_enabled: 0 },
          },
        ),
      );

      const result = await repository.updateBodyIfEligible({
        commentId: COMMENT_1_ID,
        blogPostId: BLOG_1_ID,
        authorUserId: USER_2_ID,
        body: "Too late.",
        editedAt: new Date(),
        notBefore: new Date(),
      });

      // Same window the insert guards: the service checked, then a manager
      // closed the thread before this write landed.
      expect(result).toBeNull();
      expect(updateMany).not.toHaveBeenCalled();
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
        commentId: COMMENT_1_ID,
        blogPostId: BLOG_1_ID,
        authorUserId: USER_2_ID,
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
        commentId: COMMENT_1_ID,
        blogPostId: BLOG_1_ID,
        deletedAt: new Date("2026-07-17T00:00:00.000Z"),
        deletedByUserId: USER_2_ID,
        asModerator: false,
      });

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ authorUserId: USER_2_ID }),
          data: expect.objectContaining({
            body: "",
            deletedByUserId: USER_2_ID,
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
        commentId: COMMENT_1_ID,
        blogPostId: BLOG_1_ID,
        deletedAt: new Date(),
        deletedByUserId: MANAGER_1_ID,
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
        commentId: COMMENT_1_ID,
        blogPostId: BLOG_1_ID,
        deletedAt: new Date(),
        deletedByUserId: USER_2_ID,
        asModerator: false,
      });

      // Otherwise a repeat would silently rewrite who removed it and when.
      expect(result).toBeNull();
    });
  });

  describe("createIfCommentsOpen", () => {
    it("persists the denormalized organization alongside the post", async () => {
      const create = jest.fn(async () => buildRow());
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ create }),
      );

      const result = await repository.createIfCommentsOpen({
        blogPostId: BLOG_1_ID,
        organizationId: ORG_1_ID,
        authorUserId: USER_2_ID,
        body: "Great post.",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            blogPostId: BLOG_1_ID,
            organizationId: ORG_1_ID,
            authorUserId: USER_2_ID,
            body: "Great post.",
          }),
        }),
      );
      expect(result).toMatchObject({ id: COMMENT_1_ID, deletedAt: null });
    });

    it("refuses to insert once comments were closed", async () => {
      const create = jest.fn();
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma(
          { create },
          {},
          {
            lockedPost: { status: "published", comments_enabled: 0 },
          },
        ),
      );

      const result = await repository.createIfCommentsOpen({
        blogPostId: BLOG_1_ID,
        organizationId: ORG_1_ID,
        authorUserId: USER_2_ID,
        body: "Too late.",
      });

      // The service checked before its rate-limit round trip; a manager can
      // close the thread inside that window.
      expect(result).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses to insert once the post was unpublished", async () => {
      const create = jest.fn();
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma(
          { create },
          {},
          {
            lockedPost: { status: "draft", comments_enabled: 1 },
          },
        ),
      );

      await expect(
        repository.createIfCommentsOpen({
          blogPostId: BLOG_1_ID,
          organizationId: ORG_1_ID,
          authorUserId: USER_2_ID,
          body: "Too late.",
        }),
      ).resolves.toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses to insert when the post disappeared", async () => {
      const create = jest.fn();
      const repository = new OrganizationBlogCommentsRepository(
        buildPrisma({ create }, {}, { lockedPost: null }),
      );

      await expect(
        repository.createIfCommentsOpen({
          blogPostId: BLOG_1_ID,
          organizationId: ORG_1_ID,
          authorUserId: USER_2_ID,
          body: "Too late.",
        }),
      ).resolves.toBeNull();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
