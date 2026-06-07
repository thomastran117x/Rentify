import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  AuthUserOrganizationMembershipRecord,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";

function createMembership(
  overrides: Partial<AuthUserOrganizationMembershipRecord> = {},
): AuthUserOrganizationMembershipRecord {
  return {
    membershipId: "membership-1",
    organizationId: "org-1",
    organizationName: "Northwind",
    role: "primary_manager",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "user-1",
    email: "owner@example.com",
    tokenVersion: 0,
    role: "owner",
    emailVerified: true,
    profile: {
      id: "profile-1",
      userId: "user-1",
      username: "northwind-owner",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 4,
      rentPostingsCount: 2,
      availableRentPostingsCount: 1,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    oauthIdentities: [],
    preferredOrganizationId: "org-1",
    organizationMemberships: [createMembership()],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createService(user: AuthUserRecord | null) {
  const authRepository = {
    findUserById: jest.fn(async () => user),
  };

  return {
    authRepository,
    service: new OrganizationAccessService(authRepository as never),
  };
}

describe("OrganizationAccessService", () => {
  it("returns the preferred organization membership when present", async () => {
    const preferredMembership = createMembership({ organizationId: "org-2" });
    const fallbackMembership = createMembership({
      membershipId: "membership-2",
      organizationId: "org-1",
    });
    const { service } = createService(
      createUser({
        preferredOrganizationId: "org-2",
        organizationMemberships: [fallbackMembership, preferredMembership],
      }),
    );

    await expect(service.requireActiveMembership("user-1")).resolves.toEqual(
      preferredMembership,
    );
  });

  it("falls back to the first membership when no preferred organization matches", async () => {
    const firstMembership = createMembership({ organizationId: "org-1" });
    const secondMembership = createMembership({
      membershipId: "membership-2",
      organizationId: "org-2",
    });
    const { service } = createService(
      createUser({
        preferredOrganizationId: "org-404",
        organizationMemberships: [firstMembership, secondMembership],
      }),
    );

    await expect(service.requireActiveMembership("user-1")).resolves.toEqual(
      firstMembership,
    );
  });

  it("rejects users without memberships using the caller message", async () => {
    const { service } = createService(
      createUser({
        organizationMemberships: [],
      }),
    );

    await expect(
      service.requireActiveMembership("user-1", "Join a team first."),
    ).rejects.toMatchObject<BadRequestError>({
      message: "Join a team first.",
    });
  });

  it("throws ResourceNotFoundError when the user does not exist", async () => {
    const { service } = createService(null);

    await expect(
      service.requireActiveMembership("missing-user"),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("finds and requires memberships by organization id", async () => {
    const membership = createMembership({ organizationId: "org-2" });
    const { service, authRepository } = createService(
      createUser({
        organizationMemberships: [createMembership(), membership],
      }),
    );

    await expect(service.findMembership("user-1", "org-2")).resolves.toEqual(
      membership,
    );
    await expect(service.requireMembership("user-1", "org-2")).resolves.toEqual(
      membership,
    );
    expect(authRepository.findUserById).toHaveBeenCalledWith("user-1");
  });

  it("returns null or throws ForbiddenError when the membership is missing", async () => {
    const { service } = createService(createUser());

    await expect(service.findMembership("user-1", "org-9")).resolves.toBeNull();
    await expect(
      service.requireMembership("user-1", "org-9", "No organization access."),
    ).rejects.toMatchObject<ForbiddenError>({
      message: "No organization access.",
    });
  });

  it("allows managers to manage organization resources and blocks operators", () => {
    const { service } = createService(createUser());

    expect(service.canManage("primary_manager")).toBe(true);
    expect(service.canManage("manager")).toBe(true);
    expect(service.canManage("operator")).toBe(false);
    expect(() =>
      service.assertCanManage({ role: "operator" }, "Managers only."),
    ).toThrow(ForbiddenError);
    expect(() => service.assertCanManage({ role: "manager" })).not.toThrow();
  });
});
