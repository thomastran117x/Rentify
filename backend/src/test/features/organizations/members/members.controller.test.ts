import { createTestContext, invoke } from "../../../support/mock-http";
import { OrganizationMembersController } from "@/features/organizations/members/members.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

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

describe("OrganizationMembersController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetOptionalJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createAuth());
    mockGetOptionalJwtAuth.mockResolvedValue(createAuth());
  });

  it("updates member roles from route and body values", async () => {
    const updateMemberRole = jest.fn(async () => ({
      member: {
        membershipId: MEMBER_ID,
        role: "manager",
      },
    }));
    const controller = new OrganizationMembersController({
      updateMemberRole,
    } as any);

    await invoke(
      controller.updateRole,
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
});
