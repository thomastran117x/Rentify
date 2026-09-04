import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationBlogService } from "@/features/organizations/blog/blog.service";
import type {
  ListOrganizationBlogPostsResult,
  OrganizationBlogPostRecord,
} from "@/features/organizations/blog/blog.model";
import { testUuid } from "../../../support/uuid";
const MISSING_ID = testUuid(9000, 394917);

const BLOG_1_ID = testUuid(9000, 853730);
const ORG_1_ID = testUuid(9000, 9234);
const OTHER_ID = testUuid(9000, 71578);
const USER_1_ID = testUuid(9000, 994257);

type Role = "primary_manager" | "manager" | "operator";

function createPost(
  overrides: Partial<OrganizationBlogPostRecord> = {},
): OrganizationBlogPostRecord {
  return {
    id: BLOG_1_ID,
    organizationId: ORG_1_ID,
    title: "Blog title",
    slug: "blog-title",
    excerpt: "Excerpt",
    body: "<p>Body</p>",
    tags: ["news"],
    status: "draft",
    commentsEnabled: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function createListResult(): ListOrganizationBlogPostsResult {
  return {
    posts: [createPost({ status: "published" })],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

function createService(options?: {
  membership?: { role: Role } | null;
  existing?: OrganizationBlogPostRecord | null;
  slugTaken?: string[];
  blob?: {
    configured?: boolean;
    managed?: boolean;
    owned?: boolean;
  };
}) {
  const membership =
    options && "membership" in options
      ? options.membership
      : { role: "manager" as const };
  const existing =
    options && "existing" in options
      ? options.existing
      : createPost({ status: "draft" });
  const slugTaken = new Set(options?.slugTaken ?? []);

  const repository = {
    create: jest.fn(async (input: Record<string, unknown>) =>
      createPost({
        title: input.title as string,
        slug: input.slug as string,
        excerpt: (input.excerpt as string | null) ?? undefined,
        body: input.body as string,
        tags: (input.tags as string[]) ?? [],
        coverImageUrl: (input.coverImageUrl as string | null) ?? undefined,
        coverImageBlobName:
          (input.coverImageBlobName as string | null) ?? undefined,
        status: input.status as OrganizationBlogPostRecord["status"],
        publishedAt:
          (input.publishedAt as Date | null)?.toISOString() ?? undefined,
      }),
    ),
    update: jest.fn(async (_orgId, _id, input: Record<string, unknown>) =>
      createPost({
        ...(existing ?? {}),
        ...(input.title !== undefined ? { title: input.title as string } : {}),
        ...(input.slug !== undefined ? { slug: input.slug as string } : {}),
        ...(input.body !== undefined ? { body: input.body as string } : {}),
        ...(input.excerpt !== undefined
          ? { excerpt: (input.excerpt as string | null) ?? undefined }
          : {}),
        ...(input.coverImageBlobName !== undefined
          ? {
              coverImageBlobName:
                (input.coverImageBlobName as string | null) ?? undefined,
            }
          : {}),
        ...(input.coverImageUrl !== undefined
          ? {
              coverImageUrl:
                (input.coverImageUrl as string | null) ?? undefined,
            }
          : {}),
        ...(input.status !== undefined
          ? { status: input.status as OrganizationBlogPostRecord["status"] }
          : {}),
        ...(input.commentsEnabled !== undefined
          ? { commentsEnabled: input.commentsEnabled as boolean }
          : {}),
      }),
    ),
    delete: jest.fn(async () => undefined),
    findById: jest.fn(async () => existing),
    findBySlug: jest.fn(async (_orgId: string, slug: string) =>
      slugTaken.has(slug) ? createPost({ id: OTHER_ID, slug }) : null,
    ),
    findPublishedBySlug: jest.fn(async (_orgId: string, slug: string) =>
      slug === "published-slug"
        ? createPost({ status: "published", slug })
        : null,
    ),
    list: jest.fn(async (_input: Record<string, unknown>) =>
      createListResult(),
    ),
  };
  const organizationAccessService = {
    findMembership: jest.fn(async () => membership),
    canManage: jest.fn(
      (role: Role) => role === "primary_manager" || role === "manager",
    ),
  };
  const organizationAuditService = {
    record: jest.fn(async () => undefined),
  };
  const blobService = {
    isConfigured: jest.fn(() => options?.blob?.configured ?? true),
    isManagedBlobUrl: jest.fn(() => options?.blob?.managed ?? true),
    isBlobOwnedByUser: jest.fn(() => options?.blob?.owned ?? true),
    deleteBlob: jest.fn(async () => undefined),
  };
  const publicSearchService = {
    searchByOrganization: jest.fn(async () => createListResult()),
    searchGlobal: jest.fn(async () => createListResult()),
  };
  const blogCommentGateway = {
    publish: jest.fn(),
    countReaders: jest.fn(async () => 0),
  };

  return {
    repository,
    organizationAccessService,
    organizationAuditService,
    blobService,
    publicSearchService,
    blogCommentGateway,
    service: new OrganizationBlogService(
      repository as never,
      organizationAccessService as never,
      organizationAuditService as never,
      blobService as never,
      publicSearchService as never,
      blogCommentGateway as never,
    ),
  };
}

describe("OrganizationBlogService", () => {
  describe("list", () => {
    it("lists all posts for managers", async () => {
      const { service, repository } = createService({
        membership: { role: "primary_manager" },
      });

      await service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
      });

      const args = repository.list.mock.calls[0][0] as Record<string, unknown>;
      expect(args.statuses).toBeUndefined();
    });

    it("restricts operators to published posts", async () => {
      const { service, repository } = createService({
        membership: { role: "operator" },
      });

      await service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
      });

      const args = repository.list.mock.calls[0][0] as Record<string, unknown>;
      expect(args.statuses).toEqual(["published"]);
    });

    it("ignores a draft status filter requested by an operator", async () => {
      const { service, repository } = createService({
        membership: { role: "operator" },
      });

      await service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
        status: "draft",
      });

      const args = repository.list.mock.calls[0][0] as Record<string, unknown>;
      // The requested status must not leak through; published-only is enforced.
      expect(args.status).toBeUndefined();
      expect(args.statuses).toEqual(["published"]);
    });

    it("forwards a manager's status filter", async () => {
      const { service, repository } = createService({
        membership: { role: "manager" },
      });

      await service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
        status: "draft",
      });

      const args = repository.list.mock.calls[0][0] as Record<string, unknown>;
      expect(args.status).toBe("draft");
      expect(args.statuses).toBeUndefined();
    });

    it("rejects non-members", async () => {
      const { service } = createService({ membership: null });

      await expect(
        service.list({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe("public reads", () => {
    it("delegates the per-organization public feed to the search service", async () => {
      const { service, publicSearchService } = createService();

      await service.listPublished({
        organizationId: ORG_1_ID,
        page: 1,
        pageSize: 20,
        q: "weekend",
      });

      expect(publicSearchService.searchByOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_1_ID, q: "weekend" }),
      );
    });

    it("delegates the global blog feed to the search service", async () => {
      const { service, publicSearchService } = createService();

      await service.searchGlobal({ page: 1, pageSize: 20, q: "guides" });

      expect(publicSearchService.searchGlobal).toHaveBeenCalledWith(
        expect.objectContaining({ q: "guides" }),
      );
    });

    it("returns a published post by slug", async () => {
      const { service } = createService();

      const post = await service.getPublishedBySlug({
        organizationId: ORG_1_ID,
        slug: "published-slug",
      });

      expect(post.slug).toBe("published-slug");
    });

    it("throws when the slug is not a published post", async () => {
      const { service } = createService();

      await expect(
        service.getPublishedBySlug({
          organizationId: ORG_1_ID,
          slug: MISSING_ID,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe("create", () => {
    it("creates a post, derives a slug, and records an audit entry", async () => {
      const { service, repository, organizationAuditService } = createService();

      const result = await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "Hello World Post!",
        body: "<p>Content</p>",
        status: "published",
        tags: ["news"],
      });

      const createArgs = repository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArgs.slug).toBe("hello-world-post");
      expect(createArgs.status).toBe("published");
      expect(createArgs.publishedAt).toBeInstanceOf(Date);
      expect(result.status).toBe("published");
      expect(organizationAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "blog.created",
          resourceType: "blog",
        }),
      );
    });

    it("appends a numeric suffix when the slug is taken", async () => {
      const { service, repository } = createService({
        slugTaken: ["hello-world", "hello-world-2"],
      });

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "Hello World",
        body: "<p>Content</p>",
        status: "draft",
      });

      const createArgs = repository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArgs.slug).toBe("hello-world-3");
    });

    it("sanitizes script tags out of the body", async () => {
      const { service, repository } = createService();

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "Safe post",
        body: '<p>Safe</p><script>alert("xss")</script><a href="javascript:alert(1)">bad</a>',
        status: "draft",
      });

      const createArgs = repository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const body = createArgs.body as string;
      expect(body).not.toContain("<script>");
      expect(body).not.toContain("javascript:");
      expect(body).toContain("<p>Safe</p>");
    });

    it("derives an excerpt from the body when none is supplied", async () => {
      const { service, repository } = createService();

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "No excerpt",
        body: "<p>This becomes the excerpt.</p>",
        status: "draft",
      });

      const createArgs = repository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArgs.excerpt).toBe("This becomes the excerpt.");
    });

    it("rejects a body that is empty after sanitization", async () => {
      const { service } = createService();

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Empty",
          body: "<script>alert(1)</script>",
          status: "draft",
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("rejects operators", async () => {
      const { service } = createService({ membership: { role: "operator" } });

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Nope",
          body: "<p>x</p>",
          status: "draft",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("accepts a valid managed cover image", async () => {
      const { service, repository } = createService();

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "With cover",
        body: "<p>x</p>",
        status: "draft",
        coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
        coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
      });

      const createArgs = repository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArgs.coverImageBlobName).toBe(
        `organizations/${ORG_1_ID}/blog/c.png`,
      );
    });

    it("rejects a cover image outside the organizations blob scope", async () => {
      const { service } = createService();

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Bad cover",
          body: "<p>x</p>",
          status: "draft",
          coverImageUrl: `https://cdn/${OTHER_ID}/c.png`,
          coverImageBlobName: `${OTHER_ID}/c.png`,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("rejects a cover image blob not owned by the actor", async () => {
      const { service } = createService({ blob: { owned: false } });

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Bad cover",
          body: "<p>x</p>",
          status: "draft",
          coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
          coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("rejects a cover image with only one of url/blob provided", async () => {
      const { service } = createService();

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Bad cover",
          body: "<p>x</p>",
          status: "draft",
          coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("rejects a cover image when blob storage is not configured", async () => {
      const { service } = createService({ blob: { configured: false } });

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Cover",
          body: "<p>x</p>",
          status: "draft",
          coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
          coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("rejects a cover image whose url does not match the blob", async () => {
      const { service } = createService({ blob: { managed: false } });

      await expect(
        service.create({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          title: "Cover",
          body: "<p>x</p>",
          status: "draft",
          coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/c.png`,
          coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("allows explicitly clearing the cover image with nulls", async () => {
      const { service, repository } = createService();

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "No cover",
        body: "<p>x</p>",
        status: "draft",
        coverImageUrl: null,
        coverImageBlobName: null,
      });

      const createArgs = repository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArgs.coverImageBlobName).toBeNull();
    });
  });

  describe("comments toggle", () => {
    it("records the comment setting in the audit snapshot", async () => {
      const { service, organizationAuditService } = createService({
        existing: createPost({ commentsEnabled: true }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        commentsEnabled: false,
      });

      expect(organizationAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          afterSnapshot: expect.objectContaining({ commentsEnabled: false }),
          beforeSnapshot: expect.objectContaining({ commentsEnabled: true }),
        }),
      );
    });

    it("tells open pages when comments are closed", async () => {
      const { service, blogCommentGateway } = createService({
        existing: createPost({ commentsEnabled: true }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        commentsEnabled: false,
      });

      expect(blogCommentGateway.publish).toHaveBeenCalledWith({
        type: "comments.closed",
        blogPostId: BLOG_1_ID,
        commentsEnabled: false,
      });
    });

    it("stays quiet when an unrelated field changes", async () => {
      const { service, blogCommentGateway } = createService({
        existing: createPost({ commentsEnabled: true }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        title: "A new title",
      });

      // A manager saving an unrelated edit must not make every open page
      // re-evaluate its composer.
      expect(blogCommentGateway.publish).not.toHaveBeenCalled();
    });

    it("stays quiet when the setting is re-saved unchanged", async () => {
      const { service, blogCommentGateway } = createService({
        existing: createPost({ commentsEnabled: false }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        commentsEnabled: false,
      });

      expect(blogCommentGateway.publish).not.toHaveBeenCalled();
    });

    it("defaults new posts to open comments", async () => {
      const { service, repository } = createService();

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "New post",
        body: "<p>Body</p>",
        status: "draft",
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ commentsEnabled: true }),
      );
    });

    it("honours an explicit comment setting on create", async () => {
      const { service, repository } = createService();

      await service.create({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        title: "New post",
        body: "<p>Body</p>",
        status: "draft",
        commentsEnabled: false,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ commentsEnabled: false }),
      );
    });
  });

  describe("update", () => {
    it("records a publish action when a draft transitions to published", async () => {
      const { service, organizationAuditService } = createService({
        existing: createPost({ status: "draft" }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        status: "published",
      });

      expect(organizationAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "blog.published" }),
      );
    });

    it("records an unpublished action when reverting to draft", async () => {
      const { service, organizationAuditService } = createService({
        existing: createPost({ status: "published" }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        status: "draft",
      });

      expect(organizationAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "blog.unpublished" }),
      );
    });

    it("records a generic update action when status is unchanged", async () => {
      const { service, organizationAuditService } = createService({
        existing: createPost({ status: "draft" }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        title: "Renamed",
      });

      expect(organizationAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "blog.updated" }),
      );
    });

    it("regenerates the slug only when explicitly changed", async () => {
      const { service, repository } = createService({
        existing: createPost({ slug: "old-slug" }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        slug: "new-slug",
      });

      const updateArgs = repository.update.mock.calls[0][2] as Record<
        string,
        unknown
      >;
      expect(updateArgs.slug).toBe("new-slug");
    });

    it("deletes a replaced cover image blob", async () => {
      const { service, blobService } = createService({
        existing: createPost({
          coverImageBlobName: `organizations/${ORG_1_ID}/blog/old.png`,
          coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/old.png`,
        }),
      });

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        coverImageUrl: `https://cdn/organizations/${ORG_1_ID}/blog/new.png`,
        coverImageBlobName: `organizations/${ORG_1_ID}/blog/new.png`,
      });

      expect(blobService.deleteBlob).toHaveBeenCalledWith(
        `organizations/${ORG_1_ID}/blog/old.png`,
      );
    });

    it("rejects updates for missing posts", async () => {
      const { service } = createService({ existing: null });

      await expect(
        service.update({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          blogPostId: MISSING_ID,
          title: "x",
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("sanitizes an updated body and rejects when it becomes empty", async () => {
      const { service, repository } = createService();

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        body: "<p>New body</p><script>bad()</script>",
      });
      const updateArgs = repository.update.mock.calls[0][2] as Record<
        string,
        unknown
      >;
      expect(updateArgs.body).toBe("<p>New body</p>");

      await expect(
        service.update({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          blogPostId: BLOG_1_ID,
          body: "<script>only()</script>",
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("clears the excerpt when explicitly set to null", async () => {
      const { service, repository } = createService();

      await service.update({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
        excerpt: null,
      });

      const updateArgs = repository.update.mock.calls[0][2] as Record<
        string,
        unknown
      >;
      expect(updateArgs.excerpt).toBeNull();
    });

    it("swallows audit recording failures", async () => {
      const { service, organizationAuditService } = createService();
      organizationAuditService.record.mockRejectedValueOnce(
        new Error("audit down"),
      );

      await expect(
        service.update({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          blogPostId: BLOG_1_ID,
          title: "Still works",
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("delete", () => {
    it("deletes a post, cleans up its cover, and records an audit entry", async () => {
      const { service, repository, blobService, organizationAuditService } =
        createService({
          existing: createPost({
            coverImageBlobName: `organizations/${ORG_1_ID}/blog/c.png`,
          }),
        });

      const result = await service.delete({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        blogPostId: BLOG_1_ID,
      });

      expect(repository.delete).toHaveBeenCalledWith(ORG_1_ID, BLOG_1_ID);
      expect(blobService.deleteBlob).toHaveBeenCalledWith(
        `organizations/${ORG_1_ID}/blog/c.png`,
      );
      expect(result).toEqual({ deleted: true, blogPostId: BLOG_1_ID });
      expect(organizationAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "blog.deleted" }),
      );
    });

    it("rejects operators", async () => {
      const { service } = createService({ membership: { role: "operator" } });

      await expect(
        service.delete({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          blogPostId: BLOG_1_ID,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
