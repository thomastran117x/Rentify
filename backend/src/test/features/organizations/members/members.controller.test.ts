import { createTestContext, invoke } from "../../../support/mock-http";
import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import { OrganizationMembersController } from "@/features/organizations/members/members.controller";
import type { OrganizationMembersService } from "@/features/organizations/members/members.service";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();
const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

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

function createController(service: Record<string, jest.Mock>) {
  return new OrganizationMembersController(
    service as unknown as OrganizationMembersService,
    {} as MfaVerificationService,
  );
}

describe("OrganizationMembersController", () => {
  beforeEach(() => {
    mockRequireRecentMfaVerification.mockReset();
    mockRequireRecentMfaVerification.mockResolvedValue(createAuth());
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
    const controller = createController({ updateMemberRole });

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
      actorUserId: USER_1_ID,
      membershipId: MEMBER_ID,
      role: "manager",
    });
    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
  });

  it("removes a member once the session has a recent proof", async () => {
    const removeMember = jest.fn(async () => ({
      removed: true,
      membershipId: MEMBER_ID,
    }));
    const controller = createController({ removeMember });

    await invoke(
      controller.remove,
      createContext({ params: { id: ORGANIZATION_ID, memberId: MEMBER_ID } }),
    );

    expect(removeMember).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_1_ID,
      membershipId: MEMBER_ID,
    });
    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
  });

  it("changes nothing without a recent proof", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new MfaVerificationRequiredError(),
    );
    const updateMemberRole = jest.fn();
    const removeMember = jest.fn();
    const controller = createController({ updateMemberRole, removeMember });

    await expect(
      invoke(
        controller.updateRole,
        createContext({
          params: { id: ORGANIZATION_ID, memberId: MEMBER_ID },
          body: { role: "manager" },
        }),
      ),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
    await expect(
      invoke(
        controller.remove,
        createContext({ params: { id: ORGANIZATION_ID, memberId: MEMBER_ID } }),
      ),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);

    expect(updateMemberRole).not.toHaveBeenCalled();
    expect(removeMember).not.toHaveBeenCalled();
  });
});
