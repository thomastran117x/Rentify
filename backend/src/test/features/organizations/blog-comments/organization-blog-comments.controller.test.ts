import { createTestContext, invoke } from "../../../support/mock-http";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { OrganizationBlogCommentsController } from "@/features/organizations/blog-comments/organization-blog-comments.controller";
import type { OrganizationBlogCommentsService } from "@/features/organizations/blog-comments/organization-blog-comments.service";

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-2",
    email: "renter@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    authMethod: "jwt",
    ...overrides,
  } as JwtClaims;
}

function createContext(options?: {
  body?: unknown;
  url?: string;
  method?: string;
}) {
  return createTestContext({
    method: options?.method ?? "POST",
    // Query parameters travel in the URL: `getQuery` reads them from there, the
    // same way they arrive on a real request.
    url: options?.url ?? "/organizations/org-1/blog/my-post/comments",
    body: options?.body ?? {},
    params: { id: "org-1", slug: "my-post", commentId: "comment-1" },
    state: {
      requestId: "request-1",
      container: { resolve: () => ({ inspectRequest: () => [] }) },
    },
  });
}

function createComment() {
  return {
    id: "comment-1",
    blogPostId: "blog-1",
    organizationId: "org-1",
    author: { id: "user-2", username: "renter-one" },
    body: "Great post.",
    createdAt: "2026-07-16T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    list: jest.fn(async () => ({
      comments: [createComment()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      commentsEnabled: true,
      viewerCanComment: true,
      viewerCanModerate: false,
      viewerUserId: "user-2",
    })),
    create: jest.fn(async () => createComment()),
    update: jest.fn(async () => createComment()),
    softDelete: jest.fn(async () => ({ ...createComment(), body: "" })),
    createSocketTicket: jest.fn(async () => ({
      ticket: "ticket-1",
      expiresInSeconds: 30,
    })),
    ...overrides,
  } as unknown as OrganizationBlogCommentsService & Record<string, jest.Mock>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireJwtAuth.mockResolvedValue(createClaims());
  mockGetOptionalJwtAuth.mockResolvedValue(null);
});

describe("OrganizationBlogCommentsController", () => {
  describe("list", () => {
    it("serves an anonymous reader", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(
        controller.list,
        createContext({ method: "GET" }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          slug: "my-post",
          actorUserId: null,
        }),
      );
      expect(payload.data.comments).toHaveLength(1);
    });

    it("passes a signed-in reader's id through", async () => {
      mockGetOptionalJwtAuth.mockResolvedValue(createClaims());
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await invoke(controller.list, createContext({ method: "GET" }));

      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: "user-2" }),
      );
    });

    it("exposes pagination in the envelope meta", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(
        controller.list,
        createContext({ method: "GET" }),
      );
      const payload = await response.json();

      expect(payload.meta).toMatchObject({
        pagination: { page: 1, total: 1 },
      });
    });

    it("coerces paging from the query string", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await invoke(
        controller.list,
        createContext({
          method: "GET",
          url: "/organizations/org-1/blog/my-post/comments?page=3&pageSize=5",
        }),
      );

      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, pageSize: 5 }),
      );
    });

    it("rejects a page size beyond the maximum", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await expect(
        invoke(
          controller.list,
          createContext({
            method: "GET",
            url: "/organizations/org-1/blog/my-post/comments?pageSize=500",
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("create", () => {
    it("posts a comment for a signed-in user", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(
        controller.create,
        createContext({ body: { body: "Great post." } }),
      );
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(service.create).toHaveBeenCalledWith({
        organizationId: "org-1",
        slug: "my-post",
        actorUserId: "user-2",
        body: "Great post.",
      });
      expect(payload.data.id).toBe("comment-1");
    });

    it("rejects an empty body", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await expect(
        invoke(controller.create, createContext({ body: { body: "   " } })),
      ).rejects.toMatchObject({ status: 400 });
      expect(service.create).not.toHaveBeenCalled();
    });

    it("rejects an over-length body", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await expect(
        invoke(
          controller.create,
          createContext({ body: { body: "x".repeat(2001) } }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects unknown fields", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await expect(
        invoke(
          controller.create,
          createContext({ body: { body: "Hi", pinned: true } }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("update", () => {
    it("edits a comment", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(
        controller.update,
        createContext({ method: "PATCH", body: { body: "Edited." } }),
      );

      expect(response.status).toBe(200);
      expect(service.update).toHaveBeenCalledWith({
        organizationId: "org-1",
        slug: "my-post",
        commentId: "comment-1",
        actorUserId: "user-2",
        body: "Edited.",
      });
    });
  });

  describe("remove", () => {
    it("soft-deletes a comment", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(
        controller.remove,
        createContext({ method: "DELETE" }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(service.softDelete).toHaveBeenCalledWith({
        organizationId: "org-1",
        slug: "my-post",
        commentId: "comment-1",
        actorUserId: "user-2",
      });
      expect(payload.data.body).toBe("");
    });
  });

  describe("socketTicket", () => {
    it("issues an anonymous ticket as a scoped HttpOnly cookie", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(controller.socketTicket, createContext());
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(service.createSocketTicket).toHaveBeenCalledWith(
        "org-1",
        "my-post",
        { userId: null, sessionId: null, tokenVersion: null },
      );
      // Delivered as a cookie, never echoed in the body.
      expect(payload.data).toEqual({ expiresInSeconds: 30 });
      expect(JSON.stringify(payload)).not.toContain("ticket-1");
      expect(response.headers.get("set-cookie")).toContain(
        "rentify_blog_ws_ticket=ticket-1",
      );
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain(
        "Path=/ws/blog-comments",
      );
    });

    it("uses a cookie name distinct from the booking gateway's", async () => {
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      const response = await invoke(controller.socketTicket, createContext());

      // Path scoping alone would isolate them, but a shared name would let
      // either gateway redeem the other's ticket if a scope ever widened.
      expect(response.headers.get("set-cookie")).not.toContain(
        "rentify_ws_ticket=",
      );
    });

    it("forwards a signed-in reader's session details", async () => {
      mockGetOptionalJwtAuth.mockResolvedValue({
        ...createClaims(),
        sessionId: "session-9",
        tokenVersion: 4,
      });
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      await invoke(controller.socketTicket, createContext());

      expect(service.createSocketTicket).toHaveBeenCalledWith(
        "org-1",
        "my-post",
        { userId: "user-2", sessionId: "session-9", tokenVersion: 4 },
      );
    });

    it("rejects a personal access token", async () => {
      mockGetOptionalJwtAuth.mockResolvedValue({
        ...createClaims(),
        authMethod: "personal-access-token",
      });
      const service = createService();
      const controller = new OrganizationBlogCommentsController(service);

      // A PAT authenticates a script, not a browser session, and must not be
      // exchangeable for a long-lived connection. Rejected rather than
      // silently downgraded to anonymous.
      await expect(
        invoke(controller.socketTicket, createContext()),
      ).rejects.toMatchObject({ status: 403 });
      expect(service.createSocketTicket).not.toHaveBeenCalled();
    });
  });
});
