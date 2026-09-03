import type { AuthUserRecord } from "@/features/auth/auth.model";
import { toAuthUserProfile } from "@/features/auth/user-profile-mapper";
import { testUuid } from "../../support/uuid";
const ORG_1_ID = testUuid(9200, 9234);
const ORG_MISSING_ID = testUuid(9000, 286522);

const ORG_2_ID = testUuid(9000, 9235);
const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);

function createUser(): AuthUserRecord {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 2,
    firstName: "Test",
    lastName: "User",
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      id: PROFILE_1_ID,
      userId: USER_1_ID,
      username: "test-user",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 80,
      rentPostingsCount: 0,
      availableRentPostingsCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const memberships = [
  {
    membershipId: "membership-1",
    organizationId: ORG_1_ID,
    organizationName: "Northwind",
    role: "operator" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    membershipId: "membership-2",
    organizationId: ORG_2_ID,
    organizationName: "Acme",
    role: "manager" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("toAuthUserProfile", () => {
  it("maps the record onto the public profile shape", () => {
    expect(toAuthUserProfile(createUser())).toMatchObject({
      id: USER_1_ID,
      email: "user@example.com",
      username: "test-user",
      role: "user",
      emailVerified: true,
      organizationMembershipCount: 0,
    });
  });

  it("selects the preferred organization as active", () => {
    expect(
      toAuthUserProfile({
        ...createUser(),
        preferredOrganizationId: ORG_2_ID,
        organizationMemberships: memberships,
      }),
    ).toMatchObject({
      activeOrganization: { id: ORG_2_ID, name: "Acme", role: "manager" },
      organizationMembershipCount: 2,
    });
  });

  it("falls back to the first membership when the preference does not match", () => {
    expect(
      toAuthUserProfile({
        ...createUser(),
        preferredOrganizationId: ORG_MISSING_ID,
        organizationMemberships: memberships,
      }),
    ).toMatchObject({
      activeOrganization: { id: ORG_1_ID, name: "Northwind", role: "operator" },
    });
  });

  it("reports no active organization without memberships", () => {
    const profile = toAuthUserProfile(createUser());

    expect(profile.activeOrganization).toBeUndefined();
    expect(profile.organizationMembershipCount).toBe(0);
  });

  it("tolerates a non-array memberships value from the repository", () => {
    const profile = toAuthUserProfile({
      ...createUser(),
      organizationMemberships: undefined as never,
    });

    expect(profile.activeOrganization).toBeUndefined();
    expect(profile.organizationMembershipCount).toBe(0);
  });
});
