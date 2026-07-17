import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const AUDIT_ID = "44444444-4444-4444-8444-444444444444";
const ANNOUNCEMENT_ID = "55555555-5555-4555-8555-555555555555";

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: "user-1",
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
  const variables = new Map<string, unknown>();
  variables.set("requestId", "request-1");
  variables.set("container", {
    resolve: () => ({
      inspectRequest: () => [],
    }),
  });

  const context = {
    req: {
      json: async () => options?.body ?? {},
      query: () => options?.query ?? {},
      param: (name?: string) =>
        name ? options?.params?.[name] : (options?.params ?? {}),
    },
    get: (name: string) => variables.get(name),
    set: (name: string, value: unknown) => {
      variables.set(name, value);
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

describe("OrganizationsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetOptionalJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createAuth());
    mockGetOptionalJwtAuth.mockResolvedValue(createAuth());
  });

  it("creates organizations for the authenticated actor", async () => {
    const createOrganization = jest.fn(async () => ({
      organization: {
        id: ORGANIZATION_ID,
        name: "Northwind",
        role: "primary_manager",
      },
    }));
    const controller = new OrganizationsController({
      createOrganization,
    } as any);

    const response = await controller.create(
      createContext({
        body: {
          name: "Northwind",
        },
      }),
    );

    expect(createOrganization).toHaveBeenCalledWith({
      actorUserId: "user-1",
      name: "Northwind",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Organization created successfully.",
      data: {
        organization: {
          id: ORGANIZATION_ID,
        },
      },
    });
  });

  it("lists audit entries with pagination metadata", async () => {
    const listAudit = jest.fn(async () => ({
      auditLogs: [],
      pagination: {
        page: 2,
        pageSize: 10,
        total: 0,
      },
    }));
    const controller = new OrganizationsController({
      listAudit,
    } as any);

    const response = await controller.listAudit(
      createContext({
        params: {
          id: ORGANIZATION_ID,
        },
        query: {
          page: "2",
          pageSize: "10",
          resourceType: "posting",
        },
      }),
    );

    expect(listAudit).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
      page: 2,
      pageSize: 10,
      resourceType: "posting",
    });
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        requestId: "request-1",
        pagination: {
          page: 2,
          pageSize: 10,
          total: 0,
        },
      },
    });
  });

  it("restores audit entries by organization and audit id", async () => {
    const restoreVersion = jest.fn(async () => ({
      restored: true,
      auditLog: {
        id: AUDIT_ID,
        action: "organization.restored",
      },
    }));
    const controller = new OrganizationsController({
      restoreVersion,
    } as any);

    const response = await controller.restoreAuditEntry(
      createContext({
        params: {
          id: ORGANIZATION_ID,
          auditId: AUDIT_ID,
        },
      }),
    );

    expect(restoreVersion).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
      auditId: AUDIT_ID,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Organization version restored successfully.",
      data: {
        restored: true,
      },
    });
  });

  it("updates member roles from route and body values", async () => {
    const updateMemberRole = jest.fn(async () => ({
      member: {
        membershipId: MEMBER_ID,
        role: "manager",
      },
    }));
    const controller = new OrganizationsController({
      updateMemberRole,
    } as any);

    await controller.updateMemberRole(
      createContext({
        params: {
          id: ORGANIZATION_ID,
          memberId: MEMBER_ID,
        },
        body: {
          role: "manager",
        },
      }),
    );

    expect(updateMemberRole).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
      membershipId: MEMBER_ID,
      role: "manager",
    });
  });

  it("passes invite tokens and optional auth to preview requests", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const previewInvitation = jest.fn(async () => ({
      invitation: {
        organizationId: ORGANIZATION_ID,
      },
      viewer: {
        authenticated: false,
      },
    }));
    const controller = new OrganizationsController({
      previewInvitation,
    } as any);

    await controller.previewInvitation(
      createContext({
        params: {
          token: "invite-token",
        },
      }),
    );

    expect(previewInvitation).toHaveBeenCalledWith({
      token: "invite-token",
      userId: undefined,
    });
  });

  it("revokes invitations using route ids", async () => {
    const revokeInvitation = jest.fn(async () => ({
      invitation: {
        id: INVITE_ID,
      },
    }));
    const controller = new OrganizationsController({
      revokeInvitation,
    } as any);

    await controller.revokeInvitation(
      createContext({
        params: {
          id: ORGANIZATION_ID,
          inviteId: INVITE_ID,
        },
      }),
    );

    expect(revokeInvitation).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
      invitationId: INVITE_ID,
    });
  });

  it("lists announcements with pagination metadata", async () => {
    const listAnnouncements = jest.fn(async () => ({
      announcements: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
      },
    }));
    const controller = new OrganizationsController({
      listAnnouncements,
    } as any);

    const response = await controller.listAnnouncements(
      createContext({
        params: { id: ORGANIZATION_ID },
        query: { status: "published" },
      }),
    );

    expect(listAnnouncements).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
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
    const createAnnouncement = jest.fn(async () => ({
      id: ANNOUNCEMENT_ID,
      status: "published",
    }));
    const controller = new OrganizationsController({
      createAnnouncement,
    } as any);

    const response = await controller.createAnnouncement(
      createContext({
        params: { id: ORGANIZATION_ID },
        body: {
          title: "New announcement",
          body: "Announcement body text",
          status: "published",
        },
      }),
    );

    expect(createAnnouncement).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
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
    const updateAnnouncement = jest.fn(async () => ({
      id: ANNOUNCEMENT_ID,
      status: "draft",
    }));
    const controller = new OrganizationsController({
      updateAnnouncement,
    } as any);

    await controller.updateAnnouncement(
      createContext({
        params: {
          id: ORGANIZATION_ID,
          announcementId: ANNOUNCEMENT_ID,
        },
        body: { status: "draft" },
      }),
    );

    expect(updateAnnouncement).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
      announcementId: ANNOUNCEMENT_ID,
      status: "draft",
    });
  });

  it("deletes announcements by organization and announcement id", async () => {
    const deleteAnnouncement = jest.fn(async () => ({
      deleted: true,
      announcementId: ANNOUNCEMENT_ID,
    }));
    const controller = new OrganizationsController({
      deleteAnnouncement,
    } as any);

    const response = await controller.deleteAnnouncement(
      createContext({
        params: {
          id: ORGANIZATION_ID,
          announcementId: ANNOUNCEMENT_ID,
        },
      }),
    );

    expect(deleteAnnouncement).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: "user-1",
      announcementId: ANNOUNCEMENT_ID,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Organization announcement deleted successfully.",
      data: { deleted: true },
    });
  });
});
