import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { createFixtureId } from "@/seeds/types";
import {
  SEED_DEVICES,
  SEED_OAUTH_IDENTITIES,
  SEED_PERSONAL_ACCESS_TOKENS,
  SEED_USERS,
} from "@/seeds/fixtures/users";
import type { SeedModule, SeedUserFixture } from "@/seeds/types";

const BCRYPT_SALT_ROUNDS = 12;

async function hashPasswords(): Promise<Map<string, string>> {
  const values = new Set(SEED_USERS.map((user) => user.password));
  const hashes = new Map<string, string>();

  for (const value of values) {
    hashes.set(value, await bcrypt.hash(value, BCRYPT_SALT_ROUNDS));
  }

  return hashes;
}

export const usersSeedModule: SeedModule = {
  name: "users",
  async run({ logger, prisma, state }) {
    const passwordHashes = await hashPasswords();
    let ownerOrganizationIndex = 1;

    for (const fixtureUser of SEED_USERS) {
      const passwordHash = passwordHashes.get(fixtureUser.password);

      if (!passwordHash) {
        throw new Error(`Missing password hash for ${fixtureUser.email}.`);
      }

      const user = await prisma.user.upsert({
        where: {
          email: fixtureUser.email,
        },
        update: {
          passwordHash,
          firstName: fixtureUser.firstName,
          lastName: fixtureUser.lastName,
          role: fixtureUser.role,
          emailVerified: fixtureUser.emailVerified,
        },
        create: {
          id: fixtureUser.id,
          email: fixtureUser.email,
          passwordHash,
          firstName: fixtureUser.firstName,
          lastName: fixtureUser.lastName,
          role: fixtureUser.role,
          emailVerified: fixtureUser.emailVerified,
        },
        select: {
          id: true,
        },
      });

      state.userIdsByEmail.set(fixtureUser.email, user.id);

      await prisma.profile.upsert({
        where: {
          userId: user.id,
        },
        update: {
          username: fixtureUser.username,
          phoneNumber: fixtureUser.phoneNumber ?? null,
          avatarUrl: fixtureUser.avatarUrl ?? null,
          isPrivate: false,
          recommendationPersonalizationEnabled: true,
          trustworthinessScore: fixtureUser.trustworthinessScore ?? 1,
        },
        create: {
          id: randomUUID(),
          userId: user.id,
          username: fixtureUser.username,
          phoneNumber: fixtureUser.phoneNumber ?? null,
          avatarUrl: fixtureUser.avatarUrl ?? null,
          isPrivate: false,
          recommendationPersonalizationEnabled: true,
          trustworthinessScore: fixtureUser.trustworthinessScore ?? 1,
        },
      });

      if (fixtureUser.role === "owner") {
        const organizationId = createFixtureId(1040, ownerOrganizationIndex);
        ownerOrganizationIndex += 1;
        const organizationName = buildOrganizationName(fixtureUser);

        await prisma.organization.upsert({
          where: {
            id: organizationId,
          },
          update: {
            name: organizationName,
          },
          create: {
            id: organizationId,
            name: organizationName,
          },
        });

        state.organizationIdsByOwnerEmail.set(fixtureUser.email, organizationId);

        await prisma.organizationMembership.upsert({
          where: {
            organizationId_userId: {
              organizationId,
              userId: user.id,
            },
          },
          update: {
            role: "primary_manager",
          },
          create: {
            id: randomUUID(),
            organizationId,
            userId: user.id,
            role: "primary_manager",
          },
        });

        await prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            preferredOrganizationId: organizationId,
          },
        });
      }
    }

    for (const fixtureUser of SEED_USERS) {
      const userId = state.userIdsByEmail.get(fixtureUser.email);

      if (!userId) {
        throw new Error(`Missing user for organization memberships ${fixtureUser.email}.`);
      }

      for (const membershipFixture of fixtureUser.organizationMemberships ?? []) {
        const organizationId = state.organizationIdsByOwnerEmail.get(
          membershipFixture.ownerEmail,
        );

        if (!organizationId) {
          throw new Error(
            `Missing organization for seeded membership owner ${membershipFixture.ownerEmail}.`,
          );
        }

        await prisma.organizationMembership.upsert({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
          update: {
            role: membershipFixture.role,
          },
          create: {
            id: randomUUID(),
            organizationId,
            userId,
            role: membershipFixture.role,
          },
        });

        if (membershipFixture.preferred) {
          await prisma.user.update({
            where: {
              id: userId,
            },
            data: {
              preferredOrganizationId: organizationId,
            },
          });
        }
      }
    }

    await prisma.device.deleteMany({
      where: {
        id: {
          in: SEED_DEVICES.map((fixture) => fixture.id),
        },
      },
    });

    for (const fixture of SEED_DEVICES) {
      const userId = state.userIdsByEmail.get(fixture.userEmail);

      if (!userId) {
        throw new Error(`Missing user for seeded device ${fixture.id}.`);
      }

      await prisma.device.create({
        data: {
          id: fixture.id,
          userId,
          deviceId: fixture.deviceId,
          type: fixture.type,
          platform: fixture.platform ?? null,
          userAgent: fixture.userAgent ?? null,
          lastIpAddress: fixture.lastIpAddress ?? null,
        },
      });
    }

    await prisma.personalAccessToken.deleteMany({
      where: {
        id: {
          in: SEED_PERSONAL_ACCESS_TOKENS.map((fixture) => fixture.id),
        },
      },
    });

    for (const fixture of SEED_PERSONAL_ACCESS_TOKENS) {
      const userId = state.userIdsByEmail.get(fixture.userEmail);

      if (!userId) {
        throw new Error(
          `Missing user for seeded personal access token ${fixture.id}.`,
        );
      }

      await prisma.personalAccessToken.create({
        data: {
          id: fixture.id,
          userId,
          name: fixture.name,
          publicId: fixture.publicId,
          tokenPrefix: fixture.tokenPrefix,
          secretHash: fixture.secretHash,
          scopes: fixture.scopes as never,
          lastUsedAt: fixture.lastUsedAt ? new Date(fixture.lastUsedAt) : null,
          expiresAt: fixture.expiresAt ? new Date(fixture.expiresAt) : null,
        },
      });
    }

    await prisma.oAuthIdentity.deleteMany({
      where: {
        id: {
          in: SEED_OAUTH_IDENTITIES.map((fixture) => fixture.id),
        },
      },
    });

    for (const fixture of SEED_OAUTH_IDENTITIES) {
      const userId = state.userIdsByEmail.get(fixture.userEmail);

      if (!userId) {
        throw new Error(
          `Missing user for seeded OAuth identity ${fixture.id}.`,
        );
      }

      await prisma.oAuthIdentity.create({
        data: {
          id: fixture.id,
          userId,
          provider: fixture.provider,
          providerUserId: fixture.providerUserId,
          providerEmail: fixture.providerEmail ?? null,
          emailVerified: fixture.emailVerified ?? true,
          displayName: fixture.displayName ?? null,
          linkedAt: fixture.linkedAt ? new Date(fixture.linkedAt) : undefined,
        },
      });
    }

    logger.info(`Seeded ${SEED_USERS.length} users and related auth fixtures.`);
  },
};

function buildOrganizationName(fixtureUser: SeedUserFixture): string {
  const fullName = [fixtureUser.firstName, fixtureUser.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) {
    return `${fullName} Organization`;
  }

  if (fixtureUser.username.trim()) {
    return `${fixtureUser.username.trim()} Organization`;
  }

  const [localPart] = fixtureUser.email.split("@");
  return `${(localPart ?? "owner").trim()} Organization`;
}
