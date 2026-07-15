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
        const organizationName = buildOrganizationName(fixtureUser);
        const organizationProfile =
          buildOrganizationProfile(ownerOrganizationIndex);
        ownerOrganizationIndex += 1;

        await prisma.organization.upsert({
          where: {
            id: organizationId,
          },
          update: {
            name: organizationName,
            ...organizationProfile,
          },
          create: {
            id: organizationId,
            name: organizationName,
            ...organizationProfile,
          },
        });

        state.organizationIdsByOwnerEmail.set(
          fixtureUser.email,
          organizationId,
        );

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
        throw new Error(
          `Missing user for organization memberships ${fixtureUser.email}.`,
        );
      }

      for (const membershipFixture of fixtureUser.organizationMemberships ??
        []) {
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

interface SeedOrganizationProfile {
  description: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  customFields: Record<string, string>;
}

// Deterministic, varied profile data so the upcoming organization-search
// feature has distinguishable content (distinct cities/countries/descriptions)
// to query and filter against, not just names.
const SEED_ORGANIZATION_PROFILES: SeedOrganizationProfile[] = [
  {
    description:
      "Boutique short-term rental group specializing in downtown loft apartments and design-forward studios.",
    websiteUrl: "https://harbor-loft-rentals.example.com",
    contactEmail: "hello@harbor-loft-rentals.example.com",
    contactPhone: "+1 (415) 555-0142",
    addressLine1: "410 Market Street",
    city: "San Francisco",
    region: "California",
    country: "United States",
    postalCode: "94111",
    customFields: { Founded: "2016", "Property type": "Urban lofts" },
  },
  {
    description:
      "Family-run holiday home network across the Alps offering ski chalets and lakeside cabins.",
    websiteUrl: "https://alpine-stays.example.com",
    contactEmail: "book@alpine-stays.example.com",
    contactPhone: "+41 44 555 0177",
    addressLine1: "Bahnhofstrasse 22",
    city: "Zurich",
    region: "Zurich",
    country: "Switzerland",
    postalCode: "8001",
    customFields: { Founded: "2009", Specialty: "Ski chalets" },
  },
  {
    description:
      "Coastal vacation rentals with beachfront villas and surf bungalows along the east coast.",
    websiteUrl: "https://byron-coastal.example.com",
    contactEmail: "stay@byron-coastal.example.com",
    contactPhone: "+61 2 5550 0199",
    addressLine1: "18 Jonson Street",
    city: "Byron Bay",
    region: "New South Wales",
    country: "Australia",
    postalCode: "2481",
    customFields: { Founded: "2018", Specialty: "Beachfront villas" },
  },
  {
    description:
      "Serviced apartments and corporate housing for long-stay business travelers.",
    websiteUrl: "https://maple-corporate-housing.example.com",
    contactEmail: "reservations@maple-corporate-housing.example.com",
    contactPhone: "+1 (416) 555-0168",
    addressLine1: "88 Queen Street West",
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "M5H 2M5",
    customFields: { Founded: "2012", Specialty: "Corporate housing" },
  },
  {
    description:
      "Heritage townhouses and canal-side flats for city breaks and extended stays.",
    websiteUrl: "https://grachten-rentals.example.com",
    contactEmail: "info@grachten-rentals.example.com",
    contactPhone: "+31 20 555 0123",
    addressLine1: "Herengracht 341",
    city: "Amsterdam",
    region: "North Holland",
    country: "Netherlands",
    postalCode: "1016 AZ",
    customFields: { Founded: "2014", "Property type": "Heritage townhouses" },
  },
  {
    description:
      "Modern co-living residences and furnished studios near the tech district.",
    websiteUrl: "https://nova-coliving.example.com",
    contactEmail: "team@nova-coliving.example.com",
    contactPhone: "+44 20 7946 0102",
    addressLine1: "1 Finsbury Avenue",
    city: "London",
    region: "England",
    country: "United Kingdom",
    postalCode: "EC2M 2PF",
    customFields: { Founded: "2020", Specialty: "Co-living" },
  },
];

function buildOrganizationProfile(index: number): SeedOrganizationProfile {
  const sample =
    SEED_ORGANIZATION_PROFILES[
      (index - 1) % SEED_ORGANIZATION_PROFILES.length
    ];
  return sample ?? SEED_ORGANIZATION_PROFILES[0]!;
}

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
