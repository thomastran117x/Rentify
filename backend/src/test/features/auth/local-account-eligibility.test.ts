import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import type {
  AuthUserRecord,
  OAuthIdentityRecord,
} from "@/features/auth/auth.model";
import {
  isEligibleForLocalPasswordManagement,
  isLocalPasswordAccount,
  requireEligibleLocalPasswordUser,
  requirePasswordlessLinkedUser,
} from "@/features/auth/local-account-eligibility";

const BCRYPT_HASH =
  "$2b$12$1M7NQyWNh5v3NFg4cTQdUeVUI5BvR9f0vAOVeI3E1FQfQ0rFJz0Vy";

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: BCRYPT_HASH,
    tokenVersion: 1,
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
    ...overrides,
  };
}

const googleIdentity: OAuthIdentityRecord = {
  id: "identity-1",
  userId: "user-1",
  provider: "google",
  providerUserId: "google-user-1",
  emailVerified: true,
  linkedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("isLocalPasswordAccount", () => {
  it("accepts an account with a bcrypt hash", () => {
    expect(isLocalPasswordAccount(createUser())).toBe(true);
  });

  it("rejects an account with no hash", () => {
    expect(isLocalPasswordAccount(createUser({ passwordHash: "" }))).toBe(
      false,
    );
  });

  it("rejects an account whose hash is not bcrypt", () => {
    expect(
      isLocalPasswordAccount(createUser({ passwordHash: "legacy-md5" })),
    ).toBe(false);
  });
});

describe("isEligibleForLocalPasswordManagement", () => {
  it("requires both a verified email and a local password", () => {
    expect(isEligibleForLocalPasswordManagement(createUser())).toBe(true);
    expect(
      isEligibleForLocalPasswordManagement(
        createUser({ emailVerified: false }),
      ),
    ).toBe(false);
    expect(
      isEligibleForLocalPasswordManagement(createUser({ passwordHash: "" })),
    ).toBe(false);
  });
});

describe("requireEligibleLocalPasswordUser", () => {
  it("returns an eligible account", () => {
    const user = createUser();

    expect(requireEligibleLocalPasswordUser(user, "Missing account.")).toBe(
      user,
    );
  });

  it("throws the supplied message when the account is missing", () => {
    expect(() =>
      requireEligibleLocalPasswordUser(null, "Missing account."),
    ).toThrow(BadRequestError);
  });

  it("directs social-only accounts back to their provider", () => {
    expect(() =>
      requireEligibleLocalPasswordUser(
        createUser({ passwordHash: "" }),
        "Missing account.",
      ),
    ).toThrow(/social sign-in provider/);
  });

  it("requires a verified email", () => {
    expect(() =>
      requireEligibleLocalPasswordUser(
        createUser({ emailVerified: false }),
        "Missing account.",
      ),
    ).toThrow(/verify your email address/);
  });
});

describe("requirePasswordlessLinkedUser", () => {
  it("returns an account that has a provider but no password", () => {
    const user = createUser({
      passwordHash: "",
      oauthIdentities: [googleIdentity],
    });

    expect(requirePasswordlessLinkedUser(user)).toBe(user);
  });

  it("throws when the account is missing", () => {
    expect(() => requirePasswordlessLinkedUser(null)).toThrow(BadRequestError);
  });

  it("redirects an account that already has a password", () => {
    expect(() => requirePasswordlessLinkedUser(createUser())).toThrow(
      /already has a password/,
    );
  });

  it("requires a verified email", () => {
    expect(() =>
      requirePasswordlessLinkedUser(
        createUser({
          passwordHash: "",
          emailVerified: false,
          oauthIdentities: [googleIdentity],
        }),
      ),
    ).toThrow(/verify your email address/);
  });

  it("refuses an account with no sign-in method at all", () => {
    expect(() =>
      requirePasswordlessLinkedUser(createUser({ passwordHash: "" })),
    ).toThrow(ConflictError);
  });
});
