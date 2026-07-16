import {
  bootstrapSeedTestDatabase,
  teardownSeedTestDatabase,
} from "../support/database-seed-harness";
import { getDatabaseClient } from "@/configuration/resources/database";
import { runSeedOrchestrator } from "@/seeds/orchestrator";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import { SEED_BOOKINGS } from "@/seeds/fixtures/bookings";
import { createFixtureId } from "@/seeds/types";

jest.setTimeout(180_000);

describe("database seed harness", () => {
  beforeAll(async () => {
    await bootstrapSeedTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await teardownSeedTestDatabase();
  }, 180_000);

  it("creates the expanded fixture dataset", async () => {
    const prisma = getDatabaseClient();

    expect(
      await prisma.posting.count({
        where: {
          id: {
            in: SEED_POSTINGS.map((posting) => posting.id),
          },
        },
      }),
    ).toBe(SEED_POSTINGS.length);

    expect(SEED_POSTINGS).toHaveLength(280);

    expect(
      await prisma.bookingRequest.count({
        where: {
          id: {
            in: SEED_BOOKINGS.map((booking) => booking.id),
          },
        },
      }),
    ).toBe(SEED_BOOKINGS.length);

    const organizationOwnedPostings = await prisma.posting.findMany({
      where: {
        id: {
          in: SEED_POSTINGS.map((posting) => posting.id),
        },
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
        availabilityStatus: true,
      },
    });

    expect(organizationOwnedPostings).toHaveLength(SEED_POSTINGS.length);
    expect(
      organizationOwnedPostings.every((posting) => posting.organizationId),
    ).toBe(true);

    const publishedAvailable = organizationOwnedPostings.filter(
      (posting) =>
        posting.status === "published" &&
        (posting.availabilityStatus === "available" ||
          posting.availabilityStatus === "limited"),
    ).length;
    const draft = organizationOwnedPostings.filter(
      (posting) => posting.status === "draft",
    ).length;
    const paused = organizationOwnedPostings.filter(
      (posting) => posting.status === "paused",
    ).length;

    expect(publishedAvailable).toBe(200);
    expect(draft).toBe(40);
    expect(paused).toBe(40);

    const ownerOneOrganization = await prisma.organization.findUnique({
      where: {
        id: createFixtureId(1040, 1),
      },
      include: {
        memberships: {
          orderBy: {
            createdAt: "asc",
          },
          include: {
            user: true,
          },
        },
      },
    });

    expect(
      ownerOneOrganization?.memberships.map((membership) => membership.role),
    ).toEqual(
      expect.arrayContaining(["primary_manager", "manager", "operator"]),
    );

    const ownerFiveOrganization = await prisma.organization.findUnique({
      where: {
        id: createFixtureId(1040, 5),
      },
      include: {
        memberships: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    expect(
      ownerFiveOrganization?.memberships.map((membership) => membership.role),
    ).toEqual(
      expect.arrayContaining(["primary_manager", "manager", "operator"]),
    );
  });

  it("restores fixture-owned rows on refresh", async () => {
    const prisma = getDatabaseClient();
    const seededPosting = SEED_POSTINGS[0];

    await prisma.posting.update({
      where: {
        id: seededPosting.id,
      },
      data: {
        name: "Mutated Local Name",
      },
    });

    await runSeedOrchestrator({
      refresh: true,
      source: "test",
    });

    const restoredPosting = await prisma.posting.findUnique({
      where: {
        id: seededPosting.id,
      },
      select: {
        name: true,
      },
    });

    expect(restoredPosting?.name).toBe(seededPosting.name);
  });
});
