import { createTestContext, invoke } from "../../../support/mock-http";
import { OrganizationProfileController } from "@/features/organizations/profile/profile.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

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

describe("OrganizationProfileController", () => {
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
    const controller = new OrganizationProfileController({
      createOrganization,
    } as any);

    const response = await invoke(
      controller.create,
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
});
