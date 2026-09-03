import ConflictError from "@/errors/http/conflict.error";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationBlogCommentsService } from "@/features/organizations/blog/comments/comments.service";
import {
  BLOG_COMMENT_AUTHOR_RATE_LIMIT,
  BLOG_COMMENT_EDIT_WINDOW_MS,
  type OrganizationBlogCommentRecord,
} from "@/features/organizations/blog/comments/comments.model";
import { testUuid } from "../../../../support/uuid";
const COMMENT_1_ID = testUuid(9000, 73688);
const RENTER_ONE_ID = testUuid(9000, 901918);

const BLOG_OTHER_ID = testUuid(9000, 805264);
const USER_9_ID = testUuid(9000, 994265);

const ORG_ID = "org-1";
const POST_ID = "blog-1";
const SLUG = "my-post";
const AUTHOR_ID = "user-2";
const MANAGER_ID = "manager-1";

function createComment(
  overrides: Partial<OrganizationBlogCommentRecord> = {},
): OrganizationBlogCommentRecord {
  return {
    id: COMMENT_1_ID,
    blogPostId: POST_ID,
    organizationId: ORG_ID,
    author: { id: AUTHOR_ID, username: RENTER_ONE_ID },
    body: "Great post.",
    createdAt: "2026-07-16T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

interface Options {
  post?: {
    status?: string;
    commentsEnabled?: boolean;
  } | null;
  comment?: OrganizationBlogCommentRecord | null;
  membershipRole?: "primary_manager" | "manager" | "operator" | null;
  rateCount?: number;
  rateTtl?: number;
  violations?: Array<{ path: string; message: string }>;
}

function createService(options: Options = {}) {
  const post =
    options.post === null
      ? null
      : {
          id: POST_ID,
          organizationId: ORG_ID,
          status: options.post?.status ?? "published",
          commentsEnabled: options.post?.commentsEnabled ?? true,
        };

  const repository = {
    findPostForComments: jest.fn(async () => post),
    findPostForCommentsById: jest.fn(async () => post),
    listByPost: jest.fn(async () => ({
      comments: [createComment()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    createIfCommentsOpen: jest.fn(async () => createComment()),
    findById: jest.fn(async () =>
      options.comment === undefined ? createComment() : options.comment,
    ),
    updateBodyIfEligible: jest.fn(async () =>
      createComment({ body: "Edited.", editedAt: "2026-07-16T00:05:00.000Z" }),
    ),
    softDeleteIfEligible: jest.fn(async () =>
      createComment({
        body: "",
        deletedAt: "2026-07-17T00:00:00.000Z",
        deletedBy: "author",
      }),
    ),
  };

  const organizationAccessService = {
    findMembership: jest.fn(async () =>
      options.membershipRole === undefined || options.membershipRole === null
        ? null
        : { role: options.membershipRole },
    ),
    canManage: jest.fn(
      (role: string) => role === "primary_manager" || role === "manager",
    ),
  };

  const contentSanitizationService = {
    inspect: jest.fn(() => options.violations ?? []),
  };

  const cacheService = {
    setJson: jest.fn(async () => undefined),
    getDeleteJson: jest.fn(async () => null),
    increment: jest.fn(async () => options.rateCount ?? 1),
    expire: jest.fn(async () => true),
    // Positive by default: an existing counter already carries its window.
    ttl: jest.fn(async () => options.rateTtl ?? 30),
  };

  const tokenService = {
    assertSessionIsUsable: jest.fn(async () => undefined),
  };

  const realtimeGateway = {
    publish: jest.fn(),
    countReaders: jest.fn(async () => 3),
  };

  return {
    repository,
    organizationAccessService,
    contentSanitizationService,
    cacheService,
    tokenService,
    realtimeGateway,
    service: new OrganizationBlogCommentsService(
      repository as never,
      organizationAccessService as never,
      contentSanitizationService as never,
      cacheService as never,
      tokenService as never,
      realtimeGateway as never,
    ),
  };
}

const listInput = {
  organizationId: ORG_ID,
  slug: SLUG,
  actorUserId: null,
  page: 1,
  pageSize: 20,
};

describe("OrganizationBlogCommentsService", () => {
  describe("list", () => {
    it("serves an anonymous reader with no capabilities", async () => {
      const { service } = createService();

      const result = await service.list(listInput);

      expect(result.comments).toHaveLength(1);
      expect(result).toMatchObject({
        commentsEnabled: true,
        viewerCanComment: false,
        viewerCanModerate: false,
        viewerUserId: null,
      });
    });

    it("does not 404 an anonymous reader who is not a member", async () => {
      // The management-side helper raises ResourceNotFoundError for
      // non-members; reusing it here would 404 every public visitor.
      const { service, organizationAccessService } = createService();

      await expect(service.list(listInput)).resolves.toBeDefined();
      expect(organizationAccessService.findMembership).not.toHaveBeenCalled();
    });

    it("grants write access to a signed-in reader", async () => {
      const { service } = createService();

      const result = await service.list({
        ...listInput,
        actorUserId: AUTHOR_ID,
      });

      expect(result).toMatchObject({
        viewerCanComment: true,
        viewerCanModerate: false,
        viewerUserId: AUTHOR_ID,
      });
    });

    it("grants moderation to a manager of the owning organization", async () => {
      const { service } = createService({ membershipRole: "manager" });

      const result = await service.list({
        ...listInput,
        actorUserId: MANAGER_ID,
      });

      expect(result.viewerCanModerate).toBe(true);
    });

    it("withholds moderation from an operator", async () => {
      const { service } = createService({ membershipRole: "operator" });

      const result = await service.list({
        ...listInput,
        actorUserId: MANAGER_ID,
      });

      expect(result.viewerCanModerate).toBe(false);
    });

    it("withholds the composer once comments are closed, managers included", async () => {
      const { service } = createService({
        post: { commentsEnabled: false },
        membershipRole: "primary_manager",
      });

      const result = await service.list({
        ...listInput,
        actorUserId: MANAGER_ID,
      });

      expect(result).toMatchObject({
        commentsEnabled: false,
        viewerCanComment: false,
        viewerCanModerate: true,
      });
    });

    it("404s an unpublished post", async () => {
      const { service } = createService({ post: { status: "draft" } });

      await expect(service.list(listInput)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("404s a post that does not exist", async () => {
      const { service } = createService({ post: null });

      await expect(service.list(listInput)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });
  });

  describe("create", () => {
    const createInput = {
      organizationId: ORG_ID,
      slug: SLUG,
      actorUserId: AUTHOR_ID,
      body: "Great post.",
    };

    it("persists a comment and publishes it once", async () => {
      const { service, repository, realtimeGateway } = createService();

      const result = await service.create(createInput);

      expect(repository.createIfCommentsOpen).toHaveBeenCalledWith({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        authorUserId: AUTHOR_ID,
        body: "Great post.",
      });
      expect(realtimeGateway.publish).toHaveBeenCalledTimes(1);
      expect(realtimeGateway.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "comment.created",
          blogPostId: POST_ID,
        }),
      );
      expect(result.id).toBe(COMMENT_1_ID);
    });

    it("409s when comments are closed", async () => {
      const { service } = createService({ post: { commentsEnabled: false } });

      await expect(service.create(createInput)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("409s a manager too when comments are closed", async () => {
      const { service } = createService({
        post: { commentsEnabled: false },
        membershipRole: "primary_manager",
      });

      // Closing comments is a statement about the post, not about privilege.
      await expect(
        service.create({ ...createInput, actorUserId: MANAGER_ID }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("404s an unpublished post", async () => {
      const { service } = createService({ post: { status: "draft" } });

      await expect(service.create(createInput)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("rejects a body that carries markup", async () => {
      const { service, repository } = createService({
        violations: [{ path: "body", message: "Markup is not allowed." }],
      });

      await expect(service.create(createInput)).rejects.toBeInstanceOf(
        BadRequestError,
      );
      expect(repository.createIfCommentsOpen).not.toHaveBeenCalled();
    });

    it("409s once the author exceeds their own budget", async () => {
      const { service, repository } = createService({
        rateCount: BLOG_COMMENT_AUTHOR_RATE_LIMIT + 1,
      });

      await expect(service.create(createInput)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(repository.createIfCommentsOpen).not.toHaveBeenCalled();
    });

    it("sets the budget window only on the first write", async () => {
      const { service, cacheService } = createService({ rateCount: 1 });

      await service.create(createInput);

      // A window refreshed on every write would never expire under load.
      expect(cacheService.expire).toHaveBeenCalledTimes(1);
    });

    it("does not extend the window on a later write", async () => {
      const { service, cacheService } = createService({ rateCount: 4 });

      await service.create(createInput);

      expect(cacheService.expire).not.toHaveBeenCalled();
    });

    it("409s when the thread closed during the write", async () => {
      const { service, repository } = createService();
      // The post was open when the service checked, and closed by the time the
      // insert re-read it under its row lock.
      repository.createIfCommentsOpen.mockResolvedValue(null as never);

      await expect(service.create(createInput)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("repairs a budget counter that lost its expiry", async () => {
      // The increment landed but the expiry that should have followed did not,
      // so the key would otherwise never expire and lock this author out for
      // good once the count passed the limit.
      const { service, cacheService } = createService({
        rateCount: 4,
        rateTtl: -1,
      });

      await service.create(createInput);

      expect(cacheService.expire).toHaveBeenCalledWith(
        expect.stringContaining("blog-comments:rate:"),
        60,
      );
    });

    it("leaves a healthy budget window alone", async () => {
      const { service, cacheService } = createService({
        rateCount: 4,
        rateTtl: 42,
      });

      await service.create(createInput);

      expect(cacheService.expire).not.toHaveBeenCalled();
    });

    it("still posts when the budget store is unreachable", async () => {
      const { service, cacheService, repository } = createService();
      cacheService.increment.mockRejectedValue(new Error("redis down"));

      await expect(service.create(createInput)).resolves.toBeDefined();
      // The IP-keyed middleware limiter still applies, so failing open here
      // degrades the budget rather than removing every bound.
      expect(repository.createIfCommentsOpen).toHaveBeenCalled();
    });

    it("returns the comment even when fan-out throws", async () => {
      const { service, realtimeGateway } = createService();
      realtimeGateway.publish.mockImplementation(() => {
        throw new Error("adapter down");
      });

      // The comment is already durably persisted; a Redis blip must not make
      // the author post it twice.
      await expect(service.create(createInput)).resolves.toMatchObject({
        id: COMMENT_1_ID,
      });
    });
  });

  describe("update", () => {
    const updateInput = {
      organizationId: ORG_ID,
      slug: SLUG,
      commentId: COMMENT_1_ID,
      actorUserId: AUTHOR_ID,
      body: "Edited.",
    };

    it("edits an author's own comment and publishes the update", async () => {
      const { service, repository, realtimeGateway } = createService();

      const result = await service.update(updateInput);

      expect(result.body).toBe("Edited.");
      expect(realtimeGateway.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comment.updated" }),
      );
    });

    it("passes the edit window boundary to the repository", async () => {
      const { service, repository } = createService();
      const before = Date.now();

      await service.update(updateInput);

      const notBefore = (repository.updateBodyIfEligible as jest.Mock).mock
        .calls[0][0].notBefore as Date;
      expect(notBefore.getTime()).toBeGreaterThanOrEqual(
        before - BLOG_COMMENT_EDIT_WINDOW_MS - 1_000,
      );
      expect(notBefore.getTime()).toBeLessThanOrEqual(
        Date.now() - BLOG_COMMENT_EDIT_WINDOW_MS + 1_000,
      );
    });

    it("403s another user editing someone else's comment", async () => {
      const { service } = createService();

      await expect(
        service.update({ ...updateInput, actorUserId: USER_9_ID }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("403s a manager editing someone else's comment", async () => {
      const { service } = createService({ membershipRole: "primary_manager" });

      // Managers remove; putting words in someone's mouth under their own name
      // is a different power.
      await expect(
        service.update({ ...updateInput, actorUserId: MANAGER_ID }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("409s once the window has closed", async () => {
      const { service, repository } = createService();
      repository.updateBodyIfEligible.mockResolvedValue(null as never);

      await expect(service.update(updateInput)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("409s when comments are closed", async () => {
      const { service } = createService({ post: { commentsEnabled: false } });

      await expect(service.update(updateInput)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("404s a comment belonging to a different post", async () => {
      const { service } = createService({
        comment: createComment({ blogPostId: BLOG_OTHER_ID }),
      });

      // Otherwise a comment id from another post would be actionable through
      // any post's route.
      await expect(service.update(updateInput)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("404s a comment that is already a tombstone", async () => {
      const { service } = createService({
        comment: createComment({
          body: "",
          deletedAt: "2026-07-17T00:00:00.000Z",
          deletedBy: "author",
        }),
      });

      await expect(service.update(updateInput)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });
  });

  describe("softDelete", () => {
    const deleteInput = {
      organizationId: ORG_ID,
      slug: SLUG,
      commentId: COMMENT_1_ID,
      actorUserId: AUTHOR_ID,
    };

    it("lets an author withdraw their own comment", async () => {
      const { service, repository, realtimeGateway } = createService();

      const result = await service.softDelete(deleteInput);

      expect(repository.softDeleteIfEligible).toHaveBeenCalledWith(
        expect.objectContaining({ asModerator: false }),
      );
      expect(result.body).toBe("");
      expect(realtimeGateway.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comment.deleted" }),
      );
    });

    it("lets a manager remove any comment on their post", async () => {
      const { service, repository } = createService({
        membershipRole: "manager",
      });

      await service.softDelete({ ...deleteInput, actorUserId: MANAGER_ID });

      expect(repository.softDeleteIfEligible).toHaveBeenCalledWith(
        expect.objectContaining({
          asModerator: true,
          deletedByUserId: MANAGER_ID,
        }),
      );
    });

    it("records an author who also manages as the author", async () => {
      const { service, repository } = createService({
        membershipRole: "primary_manager",
      });

      await service.softDelete(deleteInput);

      // So the tombstone reads honestly rather than as a moderation action.
      expect(repository.softDeleteIfEligible).toHaveBeenCalledWith(
        expect.objectContaining({ asModerator: false }),
      );
    });

    it("403s a signed-in user who is neither author nor manager", async () => {
      const { service } = createService();

      await expect(
        service.softDelete({ ...deleteInput, actorUserId: USER_9_ID }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("403s an operator", async () => {
      const { service } = createService({ membershipRole: "operator" });

      await expect(
        service.softDelete({ ...deleteInput, actorUserId: MANAGER_ID }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("works on a closed thread", async () => {
      const { service } = createService({ post: { commentsEnabled: false } });

      // Closing a thread must not trap what is already on it.
      await expect(service.softDelete(deleteInput)).resolves.toBeDefined();
    });

    it("404s a second delete", async () => {
      const { service, repository } = createService();
      repository.softDeleteIfEligible.mockResolvedValue(null as never);

      await expect(service.softDelete(deleteInput)).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });
  });

  describe("socket tickets", () => {
    it("mints a ticket carrying the session for a signed-in reader", async () => {
      const { service, cacheService } = createService();

      const result = await service.createSocketTicket(ORG_ID, SLUG, {
        userId: AUTHOR_ID,
        sessionId: "session-1",
        tokenVersion: 3,
      });

      expect(result.expiresInSeconds).toBe(30);
      expect(cacheService.setJson).toHaveBeenCalledWith(
        expect.stringContaining("blog-comments:ws-ticket:"),
        expect.objectContaining({
          blogPostId: POST_ID,
          userId: AUTHOR_ID,
          sessionId: "session-1",
          tokenVersion: 3,
        }),
        30,
      );
    });

    it("mints an anonymous ticket with no session", async () => {
      const { service, cacheService } = createService();

      await service.createSocketTicket(ORG_ID, SLUG, {
        userId: null,
        sessionId: "leaked",
        tokenVersion: 9,
      });

      expect(cacheService.setJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: null,
          sessionId: null,
          tokenVersion: null,
        }),
        30,
      );
    });

    it("refuses to mint for an unpublished post", async () => {
      const { service } = createService({ post: { status: "draft" } });

      await expect(
        service.createSocketTicket(ORG_ID, SLUG, { userId: null }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("redeems a ticket exactly once", async () => {
      const { service, cacheService } = createService();
      cacheService.getDeleteJson.mockResolvedValue({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        userId: AUTHOR_ID,
        sessionId: null,
        tokenVersion: null,
      } as never);

      const identity = await service.redeemSocketTicket("ticket");

      expect(identity).toMatchObject({ blogPostId: POST_ID });
      // Read and removed in one operation, so two concurrent upgrades cannot
      // both observe it.
      expect(cacheService.getDeleteJson).toHaveBeenCalledTimes(1);
    });

    it("returns null for an empty ticket without touching the store", async () => {
      const { service, cacheService } = createService();

      await expect(service.redeemSocketTicket("")).resolves.toBeNull();
      expect(cacheService.getDeleteJson).not.toHaveBeenCalled();
    });

    it("returns null for a ticket that was already spent", async () => {
      const { service } = createService();

      await expect(service.redeemSocketTicket("stale")).resolves.toBeNull();
    });

    it("rejects a ticket whose post was unpublished in the meantime", async () => {
      const { service, cacheService, repository } = createService();
      cacheService.getDeleteJson.mockResolvedValue({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        userId: AUTHOR_ID,
        sessionId: null,
        tokenVersion: null,
      } as never);
      repository.findPostForCommentsById.mockResolvedValue({
        id: POST_ID,
        organizationId: ORG_ID,
        status: "draft",
        commentsEnabled: true,
      });

      // The sweep closes a connection; it does not stop one being made inside
      // the ticket's 30-second window.
      await expect(service.redeemSocketTicket("ticket")).resolves.toBeNull();
    });

    it("rejects a ticket whose session was revoked in the meantime", async () => {
      const { service, cacheService, tokenService } = createService();
      cacheService.getDeleteJson.mockResolvedValue({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        userId: AUTHOR_ID,
        sessionId: "session-1",
        tokenVersion: 1,
      } as never);
      tokenService.assertSessionIsUsable.mockRejectedValue(
        new Error("revoked"),
      );

      await expect(service.redeemSocketTicket("ticket")).resolves.toBeNull();
    });
  });

  describe("authorizeStream", () => {
    it("admits an anonymous reader read-only", async () => {
      const { service } = createService();

      await expect(
        service.authorizeStream(POST_ID, null),
      ).resolves.toMatchObject({ canWrite: false, canModerate: false });
    });

    it("grants write access to a signed-in reader on an open thread", async () => {
      const { service } = createService();

      await expect(
        service.authorizeStream(POST_ID, AUTHOR_ID),
      ).resolves.toMatchObject({ canWrite: true });
    });

    it("withholds write access on a closed thread", async () => {
      const { service } = createService({ post: { commentsEnabled: false } });

      await expect(
        service.authorizeStream(POST_ID, AUTHOR_ID),
      ).resolves.toMatchObject({ canWrite: false });
    });

    it("throws once the post is no longer published", async () => {
      const { service } = createService({ post: { status: "draft" } });

      await expect(
        service.authorizeStream(POST_ID, AUTHOR_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe("assertSocketSessionValid", () => {
    it("skips the session check for an anonymous identity", async () => {
      const { service, tokenService } = createService();

      await service.assertSocketSessionValid({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        userId: null,
        sessionId: null,
        tokenVersion: null,
      });

      // Calling the token service with a null user would fail closed and
      // disconnect exactly the readers this feature exists to serve.
      expect(tokenService.assertSessionIsUsable).not.toHaveBeenCalled();
    });

    it("checks the session for a signed-in identity", async () => {
      const { service, tokenService } = createService();

      await service.assertSocketSessionValid({
        blogPostId: POST_ID,
        organizationId: ORG_ID,
        userId: AUTHOR_ID,
        sessionId: "session-1",
        tokenVersion: 2,
      });

      expect(tokenService.assertSessionIsUsable).toHaveBeenCalledWith(
        AUTHOR_ID,
        "session-1",
        2,
      );
    });
  });

  describe("realtime helpers", () => {
    it("counts readers through the gateway", async () => {
      const { service } = createService();

      await expect(service.countReaders(POST_ID)).resolves.toBe(3);
    });

    it("publishes a comments toggle", () => {
      const { service, realtimeGateway } = createService();

      service.publishCommentsToggled(POST_ID, false);

      expect(realtimeGateway.publish).toHaveBeenCalledWith({
        type: "comments.closed",
        blogPostId: POST_ID,
        commentsEnabled: false,
      });
    });
  });
});
