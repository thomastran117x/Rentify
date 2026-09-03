import { OrganizationBlogRepository } from "@/features/organizations/blog/blog.repository";
import { testUuid } from "../../../support/uuid";
const BLOG_1_ID = testUuid(9000, 853730);

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

// Builds a fake Prisma client whose $transaction runs its callback with the same
// client, so create/update/delete (which now enqueue a transactional search
// outbox row) can be exercised. `createMany` on the outbox is captured so tests
// can assert the enqueue happened.
function buildTransactionalPrisma(
  blogPostMethods: Record<string, jest.Mock>,
  options?: { activeReindexRun?: unknown },
) {
  const outboxCreateMany = jest.fn(async () => ({ count: 1 }));
  const client: Record<string, unknown> = {
    organizationBlogPost: blogPostMethods,
    organizationBlogSearchReindexRun: {
      findFirst: jest.fn(async () => options?.activeReindexRun ?? null),
    },
    organizationBlogSearchOutbox: {
      createMany: outboxCreateMany,
    },
  };
  client.$transaction = jest.fn(
    async (cb: (tx: typeof client) => Promise<unknown>) => cb(client),
  );
  return { client, outboxCreateMany };
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOG_1_ID,
    organizationId: ORG_1_ID,
    author: {
      id: USER_1_ID,
      email: "owner@example.com",
      profile: {
        username: "owner-one",
        avatarUrl: "https://example.test/avatar.png",
      },
    },
    title: "Blog title",
    slug: "blog-title",
    excerpt: "Excerpt",
    body: "<p>Body</p>",
    coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
    coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
    tags: ["news", "update"],
    status: "published",
    commentsEnabled: true,
    publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("OrganizationBlogRepository", () => {
  it("creates and maps a blog post", async () => {
    const create = jest.fn(async () => buildRow());
    const { client, outboxCreateMany } = buildTransactionalPrisma({ create });
    const repository = new OrganizationBlogRepository(client as never);

    const result = await repository.create({
      organizationId: ORG_1_ID,
      authorUserId: USER_1_ID,
      title: "Blog title",
      slug: "blog-title",
      excerpt: "Excerpt",
      body: "<p>Body</p>",
      coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
      coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
      tags: ["news", "update"],
      status: "published",
      commentsEnabled: true,
      publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_1_ID,
          authorUserId: USER_1_ID,
          slug: "blog-title",
          status: "published",
        }),
      }),
    );
    expect(result).toEqual({
      id: BLOG_1_ID,
      organizationId: ORG_1_ID,
      author: {
        id: USER_1_ID,
        email: "owner@example.com",
        username: "owner-one",
        avatarUrl: "https://example.test/avatar.png",
      },
      title: "Blog title",
      slug: "blog-title",
      excerpt: "Excerpt",
      body: "<p>Body</p>",
      coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
      coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
      tags: ["news", "update"],
      status: "published",
      commentsEnabled: true,
      publishedAt: "2026-07-16T00:00:00.000Z",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    // A search "upsert" outbox row is enqueued in the same transaction.
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            blogPostId: BLOG_1_ID,
            operation: "upsert",
          }),
        ]),
      }),
    );
  });

  it("maps a draft post without author, cover, tags, or published date", async () => {
    const findFirst = jest.fn(async () =>
      buildRow({
        author: null,
        status: "draft",
        publishedAt: null,
        excerpt: null,
        coverImageUrl: null,
        coverImageBlobName: null,
        tags: null,
      }),
    );
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { findFirst },
    } as never);

    const result = await repository.findById(ORG_1_ID, BLOG_1_ID);

    expect(result?.author).toBeUndefined();
    expect(result?.publishedAt).toBeUndefined();
    expect(result?.excerpt).toBeUndefined();
    expect(result?.coverImageUrl).toBeUndefined();
    expect(result?.tags).toEqual([]);
    expect(result?.status).toBe("draft");
  });

  it("finds a published post by slug", async () => {
    const findFirst = jest.fn(async () => buildRow());
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { findFirst },
    } as never);

    await repository.findPublishedBySlug(ORG_1_ID, "blog-title");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_1_ID,
          slug: "blog-title",
          status: "published",
        },
      }),
    );
  });

  it("returns null when a post is not found by slug", async () => {
    const findFirst = jest.fn(async () => null);
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { findFirst },
    } as never);

    await expect(
      repository.findBySlug(ORG_1_ID, "missing"),
    ).resolves.toBeNull();
  });

  it("updates only the provided fields", async () => {
    const update = jest.fn(async () => buildRow({ title: "Updated" }));
    const { client, outboxCreateMany } = buildTransactionalPrisma({ update });
    const repository = new OrganizationBlogRepository(client as never);

    await repository.update(ORG_1_ID, BLOG_1_ID, {
      title: "Updated",
      tags: ["x"],
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BLOG_1_ID, organizationId: ORG_1_ID },
        data: { title: "Updated", tags: ["x"] },
      }),
    );
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            blogPostId: BLOG_1_ID,
            operation: "upsert",
          }),
        ]),
      }),
    );
  });

  it("also targets the active reindex run when one is in progress", async () => {
    const update = jest.fn(async () => buildRow());
    const { client, outboxCreateMany } = buildTransactionalPrisma(
      { update },
      {
        activeReindexRun: {
          id: "reindex-9",
          targetIndexName: "organization-blogs_v9",
        },
      },
    );
    const repository = new OrganizationBlogRepository(client as never);

    await repository.update(ORG_1_ID, BLOG_1_ID, { title: "Updated" });

    const [firstCall] = outboxCreateMany.mock.calls as unknown as Array<
      [{ data: Array<Record<string, unknown>> }]
    >;
    const entries = firstCall![0].data;
    // One live row + one row targeting the active reindex run.
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      reindexRunId: "reindex-9",
      targetIndexName: "organization-blogs_v9",
    });
  });

  it("deletes a post scoped to its organization and enqueues a delete", async () => {
    const deleteFn = jest.fn(async () => buildRow());
    const { client, outboxCreateMany } = buildTransactionalPrisma({
      delete: deleteFn,
    });
    const repository = new OrganizationBlogRepository(client as never);

    await repository.delete(ORG_1_ID, BLOG_1_ID);

    expect(deleteFn).toHaveBeenCalledWith({
      where: { id: BLOG_1_ID, organizationId: ORG_1_ID },
    });
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            blogPostId: BLOG_1_ID,
            operation: "delete",
          }),
        ]),
      }),
    );
  });

  it("orders published listings by publish date and supports tag filtering", async () => {
    const findMany = jest.fn(async () => [buildRow()]);
    const count = jest.fn(async () => 1);
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { findMany, count },
    } as never);

    const result = await repository.list({
      organizationId: ORG_1_ID,
      page: 1,
      pageSize: 20,
      statuses: ["published"],
      tag: "news",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_1_ID,
          status: { in: ["published"] },
          tags: { array_contains: "news" },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      }),
    );
    expect(result.posts).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it("orders mixed/management listings by creation date", async () => {
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { findMany, count },
    } as never);

    await repository.list({ organizationId: ORG_1_ID, page: 1, pageSize: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_1_ID },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});
