import { createTestContext, invoke } from "../../../support/mock-http";
import { OrganizationInvitationsController } from "@/features/organizations/invitations/invitations.controller";
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
const INVITE_ID = "33333333-3333-4333-8333-333333333333";

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

describe("OrganizationInvitationsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetOptionalJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createAuth());
    mockGetOptionalJwtAuth.mockResolvedValue(createAuth());
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
    const controller = new OrganizationInvitationsController({
      previewInvitation,
    } as any);

    await invoke(
      controller.preview,
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
    const controller = new OrganizationInvitationsController({
      revokeInvitation,
    } as any);

    await invoke(
      controller.revoke,
      createContext({
        params: {
          id: ORGANIZATION_ID,
          inviteId: INVITE_ID,
        },
      }),
    );

    expect(revokeInvitation).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      actorUserId: USER_1_ID,
      invitationId: INVITE_ID,
    });
  });
});
