import type { AuthUserRecord } from "@/features/auth/auth.model";
import { toAuthUserProfile } from "@/features/auth/user-profile-mapper";

function createUser(): AuthUserRecord {
  return {
    id: "user-1",
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
      id: "profile-1",
      userId: "user-1",
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
    organizationId: "org-1",
    organizationName: "Northwind",
    role: "operator" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    membershipId: "membership-2",
    organizationId: "org-2",
    organizationName: "Acme",
    role: "manager" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("toAuthUserProfile", () => {
  it("maps the record onto the public profile shape", () => {
    expect(toAuthUserProfile(createUser())).toMatchObject({
      id: "user-1",
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
        preferredOrganizationId: "org-2",
        organizationMemberships: memberships,
      }),
    ).toMatchObject({
      activeOrganization: { id: "org-2", name: "Acme", role: "manager" },
      organizationMembershipCount: 2,
    });
  });

  it("falls back to the first membership when the preference does not match", () => {
    expect(
      toAuthUserProfile({
        ...createUser(),
        preferredOrganizationId: "org-missing",
        organizationMemberships: memberships,
      }),
    ).toMatchObject({
      activeOrganization: { id: "org-1", name: "Northwind", role: "operator" },
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
