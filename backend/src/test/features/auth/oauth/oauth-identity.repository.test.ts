import { Prisma } from "@/generated/prisma/client";
import { OAuthIdentityRepository } from "@/features/auth/oauth/oauth-identity.repository";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";

function createOAuthIdentityPersistence(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "oauth-1",
    userId: "user-1",
    provider: "google",
    providerUserId: "google-user-1",
    providerEmail: "user@example.com",
    emailVerified: true,
    displayName: "Jane Doe",
    linkedAt: new Date("2026-05-01T00:00:00.000Z"),
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function createOAuthProfile(
  overrides: Record<string, unknown> = {},
): VerifiedOAuthProfile {
  return {
    provider: "google",
    providerUserId: "google-user-1",
    email: "User@Example.com",
    emailVerified: true,
    firstName: "Jane",
    lastName: "Doe",
    ...overrides,
  };
}

describe("OAuthIdentityRepository", () => {
  it("lists linked identities ordered by linkedAt", async () => {
    const findMany = jest.fn(async () => [
      createOAuthIdentityPersistence(),
      createOAuthIdentityPersistence({
        id: "oauth-2",
        provider: "apple",
        providerUserId: "apple-user-1",
        providerEmail: null,
        displayName: null,
      }),
    ]);
    const repository = new OAuthIdentityRepository({
      oAuthIdentity: {
        findMany,
      },
    } as any);

    const identities = await repository.listOAuthIdentitiesByUserId("user-1");

    expect(identities).toEqual([
      expect.objectContaining({
        provider: "google",
      }),
      expect.objectContaining({
        provider: "apple",
        providerEmail: undefined,
        displayName: undefined,
      }),
    ]);
  });

  it("links oauth identities and remaps duplicate-link races to conflicts", async () => {
    const create = jest.fn(async () =>
      createOAuthIdentityPersistence({
        provider: "microsoft",
        providerUserId: "ms-user-1",
      }),
    );
    const repository = new OAuthIdentityRepository({
      oAuthIdentity: {
        create,
      },
    } as any);

    const linked = await repository.linkOAuthIdentity(
      "user-1",
      createOAuthProfile({
        provider: "microsoft",
        providerUserId: "ms-user-1",
      }),
    );

    expect(linked).toMatchObject({
      provider: "microsoft",
      providerUserId: "ms-user-1",
    });

    const duplicateError = Object.assign(new Error("duplicate identity"), {
      code: "P2002",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      duplicateError,
      Prisma.PrismaClientKnownRequestError.prototype,
    );
    const duplicateRepository = new OAuthIdentityRepository({
      oAuthIdentity: {
        create: jest.fn(async () => {
          throw duplicateError;
        }),
      },
    } as any);

    await expect(
      duplicateRepository.linkOAuthIdentity("user-1", createOAuthProfile()),
    ).rejects.toThrow("This OAuth provider is already linked to an account.");
  });

  it("unlinks identities", async () => {
    const deleteMany = jest.fn(async () => ({
      count: 1,
    }));
    const repository = new OAuthIdentityRepository({
      oAuthIdentity: {
        deleteMany,
      },
    } as any);

    await expect(
      repository.unlinkOAuthIdentity("user-1", "google"),
    ).resolves.toBe(true);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        provider: "google",
      },
    });
  });
});
