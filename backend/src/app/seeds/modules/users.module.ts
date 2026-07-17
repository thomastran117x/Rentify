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

interface OrganizationBlogPostSeed {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  tags: string[];
  status: "draft" | "published";
  publishedDaysAgo: number | null;
}

// Seeded once per owner organization. Slugs only need to be unique within an
// organization, so the same set is reused across seeded orgs. Ordered newest to
// oldest via publishedDaysAgo so the public blog feed reads naturally.
const ORGANIZATION_BLOG_POST_SEEDS: OrganizationBlogPostSeed[] = [
  {
    title: "Introducing weekend stays at our downtown studios",
    slug: "introducing-weekend-stays",
    excerpt:
      "Weekend bookings are now open across every downtown studio, with flexible check-in and curated local guides.",
    body: "<h2>Weekend stays are here</h2><p>We are excited to open <strong>weekend bookings</strong> across all of our downtown studios. Each stay now includes flexible check-in and a curated guide to the neighborhood.</p><ul><li>Flexible check-in and check-out</li><li>Curated local recommendations</li><li>Weekend-only pricing</li></ul>",
    tags: ["announcement", "downtown", "weekend"],
    status: "published",
    publishedDaysAgo: 2,
  },
  {
    title: "Five ways to make your stay feel like home",
    slug: "five-ways-to-feel-at-home",
    excerpt:
      "Small touches make a big difference. Here are our favorite ways to settle in quickly.",
    body: "<h2>Settle in faster</h2><p>Whether you are staying for a weekend or a month, these small touches help every space feel like home.</p><ol><li>Unpack into the closet on day one</li><li>Find your nearest coffee shop</li><li>Set the lighting for the evening</li><li>Stock the kitchen essentials</li><li>Say hello to your host</li></ol><p><em>Have a tip of your own? We would love to hear it.</em></p>",
    tags: ["tips", "guests"],
    status: "published",
    publishedDaysAgo: 9,
  },
  {
    title: "Meet the team keeping every space guest-ready",
    slug: "meet-the-team",
    excerpt:
      "From housekeeping to local hosts, meet the people behind a great stay.",
    body: "<h2>The people behind your stay</h2><p>Every booking is supported by a dedicated team of hosts, cleaners, and local guides. We sat down with a few of them to learn what makes a stay special.</p><blockquote>Great hospitality is in the details you never notice.</blockquote><p>Want to join the team? Reach out through our contact page.</p>",
    tags: ["team", "behind-the-scenes"],
    status: "published",
    publishedDaysAgo: 21,
  },
  {
    title: "Seasonal pricing: what to expect this year",
    slug: "seasonal-pricing-guide",
    excerpt:
      "A quick guide to how our seasonal rates work and how to find the best value.",
    body: "<h2>How seasonal pricing works</h2><p>Rates shift with demand across the year. Booking early during peak seasons and staying midweek are the two easiest ways to find better value.</p><p>Check individual listings for current seasonal rates.</p>",
    tags: ["pricing", "guide"],
    status: "published",
    publishedDaysAgo: 34,
  },
  {
    title: "Behind the scenes: how we prepare each space (draft)",
    slug: "behind-the-scenes-preparation",
    excerpt:
      "A look at the checklist our team follows before every guest arrives.",
    body: "<p>This post is still a work in progress. We will share the full behind-the-scenes checklist soon.</p>",
    tags: ["behind-the-scenes"],
    status: "draft",
    publishedDaysAgo: null,
  },
];

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
        const organizationProfile = buildOrganizationProfile(
          ownerOrganizationIndex,
        );
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

        const announcementIndex = ownerOrganizationIndex - 1;
        const publishedAnnouncementId = createFixtureId(
          1090,
          announcementIndex * 2,
        );
        const draftAnnouncementId = createFixtureId(
          1090,
          announcementIndex * 2 + 1,
        );

        await prisma.organizationAnnouncement.upsert({
          where: { id: publishedAnnouncementId },
          update: {},
          create: {
            id: publishedAnnouncementId,
            organizationId,
            authorUserId: user.id,
            title: "Welcome to our organization workspace",
            body: "This is where we will share important updates with the whole team. Check back regularly for the latest news.",
            status: "published",
            publishedAt: new Date(),
          },
        });

        await prisma.organizationAnnouncement.upsert({
          where: { id: draftAnnouncementId },
          update: {},
          create: {
            id: draftAnnouncementId,
            organizationId,
            authorUserId: user.id,
            title: "Upcoming maintenance window (draft)",
            body: "We are planning a short maintenance window next week. Details to follow once the schedule is confirmed.",
            status: "draft",
            publishedAt: null,
          },
        });

        const blogIndex = ownerOrganizationIndex - 1;

        for (const [
          slotIndex,
          seed,
        ] of ORGANIZATION_BLOG_POST_SEEDS.entries()) {
          const blogPostId = createFixtureId(
            1091,
            blogIndex * ORGANIZATION_BLOG_POST_SEEDS.length + slotIndex,
          );

          await prisma.organizationBlogPost.upsert({
            where: { id: blogPostId },
            update: {},
            create: {
              id: blogPostId,
              organizationId,
              authorUserId: user.id,
              title: seed.title,
              slug: seed.slug,
              excerpt: seed.excerpt,
              body: seed.body,
              coverImageUrl: null,
              coverImageBlobName: null,
              tags: seed.tags,
              status: seed.status,
              publishedAt:
                seed.status === "published" && seed.publishedDaysAgo !== null
                  ? new Date(
                      Date.now() - seed.publishedDaysAgo * 24 * 60 * 60 * 1000,
                    )
                  : null,
            },
          });
        }
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
const BASE_SEED_ORGANIZATION_PROFILES: SeedOrganizationProfile[] = [
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

const ADDITIONAL_SEED_ORGANIZATION_PROFILES: SeedOrganizationProfile[] = [
  {
    description:
      "Prairie production and maker rentals for pop-up kitchens, workshops, and flexible studio bookings.",
    websiteUrl: "https://prairie-production.example.com",
    contactEmail: "hello@prairie-production.example.com",
    contactPhone: "+1 (204) 555-0120",
    addressLine1: "115 Portage Avenue",
    city: "Winnipeg",
    region: "Manitoba",
    country: "Canada",
    postalCode: "R3B 2A9",
    customFields: { Founded: "2015", Specialty: "Maker studios" },
  },
  {
    description:
      "Riverfront creative rentals with compact studios, tool bays, and flexible loading access for small teams.",
    websiteUrl: "https://riverfront-creative.example.com",
    contactEmail: "bookings@riverfront-creative.example.com",
    contactPhone: "+1 (306) 555-0134",
    addressLine1: "42 River Landing",
    city: "Saskatoon",
    region: "Saskatchewan",
    country: "Canada",
    postalCode: "S7K 3J6",
    customFields: { Founded: "2017", Specialty: "Tool bays" },
  },
  {
    description:
      "Warehouse-adjacent rentals built for fabrication, rehearsal, and local commercial production days.",
    websiteUrl: "https://warehouse-south.example.com",
    contactEmail: "team@warehouse-south.example.com",
    contactPhone: "+1 (306) 555-0148",
    addressLine1: "86 Broad Street",
    city: "Regina",
    region: "Saskatchewan",
    country: "Canada",
    postalCode: "S4P 1X8",
    customFields: { Founded: "2013", Specialty: "Warehouse shoots" },
  },
  {
    description:
      "Okanagan venue and equipment rentals focused on branded retreats, tastings, and content capture.",
    websiteUrl: "https://orchard-retreats.example.com",
    contactEmail: "stay@orchard-retreats.example.com",
    contactPhone: "+1 (250) 555-0162",
    addressLine1: "230 Bernard Avenue",
    city: "Kelowna",
    region: "British Columbia",
    country: "Canada",
    postalCode: "V1Y 6N5",
    customFields: { Founded: "2019", Specialty: "Retreat venues" },
  },
  {
    description:
      "Cross-border logistics rentals with storage, vans, and staging rooms for moving crews and events.",
    websiteUrl: "https://crosswind-logistics.example.com",
    contactEmail: "ops@crosswind-logistics.example.com",
    contactPhone: "+1 (519) 555-0176",
    addressLine1: "18 Riverside Drive West",
    city: "Windsor",
    region: "Ontario",
    country: "Canada",
    postalCode: "N9A 5K3",
    customFields: { Founded: "2011", Specialty: "Logistics hubs" },
  },
  {
    description:
      "Industrial-style studios and gear lockers tailored to product teams, builders, and short design sprints.",
    websiteUrl: "https://forge-bay.example.com",
    contactEmail: "hello@forge-bay.example.com",
    contactPhone: "+1 (905) 555-0184",
    addressLine1: "67 James Street North",
    city: "Hamilton",
    region: "Ontario",
    country: "Canada",
    postalCode: "L8R 2K3",
    customFields: { Founded: "2014", Specialty: "Industrial studios" },
  },
  {
    description:
      "Historic downtown rentals mixing heritage suites with practical production rooms and tidy storage.",
    websiteUrl: "https://limestone-works.example.com",
    contactEmail: "host@limestone-works.example.com",
    contactPhone: "+1 (613) 555-0198",
    addressLine1: "91 Princess Street",
    city: "Kingston",
    region: "Ontario",
    country: "Canada",
    postalCode: "K7L 1A6",
    customFields: { Founded: "2010", Specialty: "Heritage suites" },
  },
  {
    description:
      "Maritime rentals for tasting events, remote crews, and small retail activations near the bay.",
    websiteUrl: "https://tidehouse-rentals.example.com",
    contactEmail: "crew@tidehouse-rentals.example.com",
    contactPhone: "+1 (506) 555-0117",
    addressLine1: "55 Main Street",
    city: "Moncton",
    region: "New Brunswick",
    country: "Canada",
    postalCode: "E1C 1B9",
    customFields: { Founded: "2018", Specialty: "Retail activations" },
  },
  {
    description:
      "Compact coastal rentals for boardwalk pop-ups, market crews, and short family stays.",
    websiteUrl: "https://harbour-signal.example.com",
    contactEmail: "book@harbour-signal.example.com",
    contactPhone: "+1 (902) 555-0126",
    addressLine1: "14 Water Street",
    city: "Charlottetown",
    region: "Prince Edward Island",
    country: "Canada",
    postalCode: "C1A 1A9",
    customFields: { Founded: "2016", Specialty: "Boardwalk pop-ups" },
  },
  {
    description:
      "Atlantic-facing equipment and venue rentals optimized for documentary crews and weather-flexible stays.",
    websiteUrl: "https://signal-hill-supply.example.com",
    contactEmail: "support@signal-hill-supply.example.com",
    contactPhone: "+1 (709) 555-0139",
    addressLine1: "7 Duckworth Street",
    city: "St. John's",
    region: "Newfoundland and Labrador",
    country: "Canada",
    postalCode: "A1C 1E6",
    customFields: { Founded: "2012", Specialty: "Documentary crews" },
  },
  {
    description:
      "Northern rentals for expedition teams, remote workshops, and practical crew housing with gear capacity.",
    websiteUrl: "https://northlight-base.example.com",
    contactEmail: "hello@northlight-base.example.com",
    contactPhone: "+1 (867) 555-0145",
    addressLine1: "29 Main Street",
    city: "Whitehorse",
    region: "Yukon",
    country: "Canada",
    postalCode: "Y1A 2B2",
    customFields: { Founded: "2021", Specialty: "Expedition teams" },
  },
  {
    description:
      "Remote-ready rentals pairing rugged vehicles, bright spaces, and gear lockers for northern travel.",
    websiteUrl: "https://midnight-sun.example.com",
    contactEmail: "team@midnight-sun.example.com",
    contactPhone: "+1 (867) 555-0158",
    addressLine1: "102 Franklin Avenue",
    city: "Yellowknife",
    region: "Northwest Territories",
    country: "Canada",
    postalCode: "X1A 2N4",
    customFields: { Founded: "2022", Specialty: "Remote-ready stays" },
  },
];

const SEED_ORGANIZATION_PROFILES: SeedOrganizationProfile[] = [
  ...BASE_SEED_ORGANIZATION_PROFILES,
  ...ADDITIONAL_SEED_ORGANIZATION_PROFILES,
];

function buildOrganizationProfile(index: number): SeedOrganizationProfile {
  const sample =
    SEED_ORGANIZATION_PROFILES[(index - 1) % SEED_ORGANIZATION_PROFILES.length];
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
