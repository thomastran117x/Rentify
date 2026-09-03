import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  AuthUserOrganizationMembershipRecord,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { testUuid } from "../../support/uuid";
const MISSING_USER_ID = testUuid(9000, 791594);
const ORG_9_ID = testUuid(9000, 9242);

const MEMBERSHIP_1_ID = testUuid(9000, 649718);
const MEMBERSHIP_2_ID = testUuid(9000, 649719);
const ORG_1_ID = testUuid(9000, 9234);
const ORG_2_ID = testUuid(9000, 9235);
const ORG_404_ID = testUuid(9000, 878433);
const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);

function createMembership(
  overrides: Partial<AuthUserOrganizationMembershipRecord> = {},
): AuthUserOrganizationMembershipRecord {
  return {
    membershipId: MEMBERSHIP_1_ID,
    organizationId: ORG_1_ID,
    organizationName: "Northwind",
    role: "primary_manager",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_1_ID,
    email: "owner@example.com",
    tokenVersion: 0,
    role: "owner",
    emailVerified: true,
    profile: {
      id: PROFILE_1_ID,
      userId: USER_1_ID,
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
    preferredOrganizationId: ORG_1_ID,
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
    service: new OrganizationAccessService(authRepository as any),
  };
}

describe("OrganizationAccessService", () => {
  it("returns the preferred organization membership when present", async () => {
    const preferredMembership = createMembership({ organizationId: ORG_2_ID });
    const fallbackMembership = createMembership({
      membershipId: MEMBERSHIP_2_ID,
      organizationId: ORG_1_ID,
    });
    const { service } = createService(
      createUser({
        preferredOrganizationId: ORG_2_ID,
        organizationMemberships: [fallbackMembership, preferredMembership],
      }),
    );

    await expect(service.requireActiveMembership(USER_1_ID)).resolves.toEqual(
      preferredMembership,
    );
  });

  it("falls back to the first membership when no preferred organization matches", async () => {
    const firstMembership = createMembership({ organizationId: ORG_1_ID });
    const secondMembership = createMembership({
      membershipId: MEMBERSHIP_2_ID,
      organizationId: ORG_2_ID,
    });
    const { service } = createService(
      createUser({
        preferredOrganizationId: ORG_404_ID,
        organizationMemberships: [firstMembership, secondMembership],
      }),
    );

    await expect(service.requireActiveMembership(USER_1_ID)).resolves.toEqual(
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
      service.requireActiveMembership(USER_1_ID, "Join a team first."),
    ).rejects.toMatchObject({
      message: "Join a team first.",
    });
  });

  it("throws ResourceNotFoundError when the user does not exist", async () => {
    const { service } = createService(null);

    await expect(
      service.requireActiveMembership(MISSING_USER_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("finds and requires memberships by organization id", async () => {
    const membership = createMembership({ organizationId: ORG_2_ID });
    const { service, authRepository } = createService(
      createUser({
        organizationMemberships: [createMembership(), membership],
      }),
    );

    await expect(service.findMembership(USER_1_ID, ORG_2_ID)).resolves.toEqual(
      membership,
    );
    await expect(
      service.requireMembership(USER_1_ID, ORG_2_ID),
    ).resolves.toEqual(membership);
    expect(authRepository.findUserById).toHaveBeenCalledWith(USER_1_ID);
  });

  it("returns null or throws ForbiddenError when the membership is missing", async () => {
    const { service } = createService(createUser());

    await expect(
      service.findMembership(USER_1_ID, ORG_9_ID),
    ).resolves.toBeNull();
    await expect(
      service.requireMembership(USER_1_ID, ORG_9_ID, "No organization access."),
    ).rejects.toMatchObject({
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
