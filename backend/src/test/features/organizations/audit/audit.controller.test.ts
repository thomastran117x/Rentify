import { createTestContext, invoke } from "../../../support/mock-http";
import { OrganizationAuditController } from "@/features/organizations/audit/audit.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const AUDIT_ID = "44444444-4444-4444-8444-444444444444";

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

describe("OrganizationAuditController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetOptionalJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createAuth());
    mockGetOptionalJwtAuth.mockResolvedValue(createAuth());
  });

  it("lists audit entries with pagination metadata", async () => {
    const list = jest.fn(async () => ({
      auditLogs: [],
      pagination: {
        page: 2,
        pageSize: 10,
        total: 0,
      },
    }));
    const controller = new OrganizationAuditController({ list } as any);

    const response = await invoke(
      controller.list,
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

    expect(list).toHaveBeenCalledWith({
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
    const controller = new OrganizationAuditController({
      restoreVersion,
    } as any);

    const response = await invoke(
      controller.restoreVersion,
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
});
