import { createTestContext, invoke } from "../../../support/mock-http";
import { OrganizationAnnouncementsController } from "@/features/organizations/announcements/announcements.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ANNOUNCEMENT_ID = "55555555-5555-4555-8555-555555555555";

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: USER_1_ID,
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options?: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const query = new URLSearchParams(options?.query ?? {}).toString();

  return createTestContext({
    body: options?.body,
    params: options?.params,
    url: query ? `/?${query}` : "/",
    state: {
      requestId: "request-1",
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

describe("OrganizationAnnouncementsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetOptionalJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createAuth());
    mockGetOptionalJwtAuth.mockResolvedValue(createAuth());
  });

  it("lists announcements with pagination metadata", async () => {
    const list = jest.fn(async () => ({
      announcements: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
      },
    }));
    const controller = new OrganizationAnnouncementsController({
      list,
    } as any);

    const response = await invoke(
      controller.list,
      createContext({
        params: { id: ORGANIZATION_ID },
        query: { status: "published" },
      }),
    );

    expect(list).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_1_ID,
      page: 1,
      pageSize: 20,
      status: "published",
    });
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        pagination: { page: 1, pageSize: 20, total: 0 },
      },
    });
  });

  it("creates announcements from validated body values", async () => {
    const create = jest.fn(async () => ({
      id: ANNOUNCEMENT_ID,
      status: "published",
    }));
    const controller = new OrganizationAnnouncementsController({
      create,
    } as any);

    const response = await invoke(
      controller.create,
      createContext({
        params: { id: ORGANIZATION_ID },
        body: {
          title: "New announcement",
          body: "Announcement body text",
          status: "published",
        },
      }),
    );

    expect(create).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_1_ID,
      title: "New announcement",
      body: "Announcement body text",
      status: "published",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      message: "Organization announcement created successfully.",
    });
  });

  it("updates announcements from route and body values", async () => {
    const update = jest.fn(async () => ({
      id: ANNOUNCEMENT_ID,
      status: "draft",
    }));
    const controller = new OrganizationAnnouncementsController({
      update,
    } as any);

    await invoke(
      controller.update,
      createContext({
        params: {
          id: ORGANIZATION_ID,
          announcementId: ANNOUNCEMENT_ID,
        },
        body: { status: "draft" },
      }),
    );

    expect(update).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_1_ID,
      announcementId: ANNOUNCEMENT_ID,
      status: "draft",
    });
  });

  it("deletes announcements by organization and announcement id", async () => {
    const deleteAnnouncement = jest.fn(async () => ({
      deleted: true,
      announcementId: ANNOUNCEMENT_ID,
    }));
    const controller = new OrganizationAnnouncementsController({
      delete: deleteAnnouncement,
    } as any);

    const response = await invoke(
      controller.delete,
      createContext({
        params: {
          id: ORGANIZATION_ID,
          announcementId: ANNOUNCEMENT_ID,
        },
      }),
    );

    expect(deleteAnnouncement).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_1_ID,
      announcementId: ANNOUNCEMENT_ID,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Organization announcement deleted successfully.",
      data: { deleted: true },
    });
  });
});
