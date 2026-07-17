import { OrganizationBlogRepository } from "@/features/organizations/organization-blog.repository";

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "blog-1",
    organizationId: "org-1",
    author: {
      id: "user-1",
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
    coverImageUrl: "https://cdn/organizations/org-1/blog/c.png",
    coverImageBlobName: "organizations/org-1/blog/c.png",
    tags: ["news", "update"],
    status: "published",
    publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("OrganizationBlogRepository", () => {
  it("creates and maps a blog post", async () => {
    const create = jest.fn(async () => buildRow());
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { create },
    } as never);

    const result = await repository.create({
      organizationId: "org-1",
      authorUserId: "user-1",
      title: "Blog title",
      slug: "blog-title",
      excerpt: "Excerpt",
      body: "<p>Body</p>",
      coverImageUrl: "https://cdn/organizations/org-1/blog/c.png",
      coverImageBlobName: "organizations/org-1/blog/c.png",
      tags: ["news", "update"],
      status: "published",
      publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          authorUserId: "user-1",
          slug: "blog-title",
          status: "published",
        }),
      }),
    );
    expect(result).toEqual({
      id: "blog-1",
      organizationId: "org-1",
      author: {
        id: "user-1",
        email: "owner@example.com",
        username: "owner-one",
        avatarUrl: "https://example.test/avatar.png",
      },
      title: "Blog title",
      slug: "blog-title",
      excerpt: "Excerpt",
      body: "<p>Body</p>",
      coverImageUrl: "https://cdn/organizations/org-1/blog/c.png",
      coverImageBlobName: "organizations/org-1/blog/c.png",
      tags: ["news", "update"],
      status: "published",
      publishedAt: "2026-07-16T00:00:00.000Z",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
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

    const result = await repository.findById("org-1", "blog-1");

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

    await repository.findPublishedBySlug("org-1", "blog-title");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
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

    await expect(repository.findBySlug("org-1", "missing")).resolves.toBeNull();
  });

  it("updates only the provided fields", async () => {
    const update = jest.fn(async () => buildRow({ title: "Updated" }));
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { update },
    } as never);

    await repository.update("org-1", "blog-1", {
      title: "Updated",
      tags: ["x"],
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "blog-1", organizationId: "org-1" },
        data: { title: "Updated", tags: ["x"] },
      }),
    );
  });

  it("deletes a post scoped to its organization", async () => {
    const deleteFn = jest.fn(async () => buildRow());
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { delete: deleteFn },
    } as never);

    await repository.delete("org-1", "blog-1");

    expect(deleteFn).toHaveBeenCalledWith({
      where: { id: "blog-1", organizationId: "org-1" },
    });
  });

  it("orders published listings by publish date and supports tag filtering", async () => {
    const findMany = jest.fn(async () => [buildRow()]);
    const count = jest.fn(async () => 1);
    const repository = new OrganizationBlogRepository({
      organizationBlogPost: { findMany, count },
    } as never);

    const result = await repository.list({
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
      statuses: ["published"],
      tag: "news",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
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

    await repository.list({ organizationId: "org-1", page: 1, pageSize: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});
