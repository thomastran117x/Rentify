import { Prisma, type PrismaClient } from "@prisma/client";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import type { SeedModule } from "@/seeds/types";

const LEGACY_SEED_POSTING_IDS = [
  "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
  "aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
  "aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaa5",
  "aaaaaaa6-aaaa-aaaa-aaaa-aaaaaaaaaaa6",
  "aaaaaaa7-aaaa-aaaa-aaaa-aaaaaaaaaaa7",
  "aaaaaa11-aaaa-aaaa-aaaa-aaaaaaaaaa11",
  "aaaaaa12-aaaa-aaaa-aaaa-aaaaaaaaaa12",
  "aaaaaa13-aaaa-aaaa-aaaa-aaaaaaaaaa13",
  "aaaaaa14-aaaa-aaaa-aaaa-aaaaaaaaaa14",
  "aaaaaa15-aaaa-aaaa-aaaa-aaaaaaaaaa15",
  "aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
  "aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
  "aaaaaaa8-aaaa-aaaa-aaaa-aaaaaaaaaaa8",
  "aaaaaaa9-aaaa-aaaa-aaaa-aaaaaaaaaaa9",
  "aaaaaa10-aaaa-aaaa-aaaa-aaaaaaaaaa10",
  "aaaaaa16-aaaa-aaaa-aaaa-aaaaaaaaaa16",
  "aaaaaa17-aaaa-aaaa-aaaa-aaaaaaaaaa17",
  "aaaaaa18-aaaa-aaaa-aaaa-aaaaaaaaaa18",
  "aaaaaa19-aaaa-aaaa-aaaa-aaaaaaaaaa19",
  "aaaaaa20-aaaa-aaaa-aaaa-aaaaaaaaaa20",
];

function buildLifecycleTimestamps(
  index: number,
  status: "draft" | "published" | "paused",
) {
  const base = new Date("2026-04-01T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() + index);

  return {
    publishedAt: status === "published" ? base : null,
    pausedAt: status === "paused" ? base : null,
  };
}

function toPostingDetailsColumns(
  family: "place" | "equipment" | "vehicle",
  details: Record<string, unknown>,
) {
  switch (family) {
    case "place":
      return {
        placeDetails: details as never,
        equipmentDetails: Prisma.DbNull,
        vehicleDetails: Prisma.DbNull,
      };
    case "equipment":
      return {
        placeDetails: Prisma.DbNull,
        equipmentDetails: details as never,
        vehicleDetails: Prisma.DbNull,
      };
    case "vehicle":
      return {
        placeDetails: Prisma.DbNull,
        equipmentDetails: Prisma.DbNull,
        vehicleDetails: details as never,
      };
  }
}

async function syncOwnerProfilePostingCounts(
  userIdsByEmail: Map<string, string>,
  prisma: PrismaClient,
): Promise<void> {
  const ownerEmails = Array.from(
    new Set(SEED_POSTINGS.map((posting) => posting.ownerEmail)),
  );

  for (const ownerEmail of ownerEmails) {
    const ownerId = userIdsByEmail.get(ownerEmail);

    if (!ownerId) {
      continue;
    }

    const [rentPostingsCount, availableRentPostingsCount] = await Promise.all([
      prisma.posting.count({
        where: {
          ownerId,
          status: {
            in: ["draft", "published", "paused"],
          },
        },
      }),
      prisma.posting.count({
        where: {
          ownerId,
          status: "published",
          availabilityStatus: {
            in: ["available", "limited"],
          },
        },
      }),
    ]);

    await prisma.profile.update({
      where: {
        userId: ownerId,
      },
      data: {
        rentPostingsCount,
        availableRentPostingsCount,
      },
    });
  }
}

export const postingsSeedModule: SeedModule = {
  name: "postings",
  async run({ logger, prisma, state }) {
    await prisma.posting.deleteMany({
      where: {
        id: {
          in: LEGACY_SEED_POSTING_IDS,
        },
      },
    });

    for (const [index, fixturePosting] of SEED_POSTINGS.entries()) {
      const ownerId = state.userIdsByEmail.get(fixturePosting.ownerEmail);
      const organizationId = state.organizationIdsByOwnerEmail.get(
        fixturePosting.ownerEmail,
      );

      if (!ownerId) {
        throw new Error(
          `Missing fixture owner for posting seed: ${fixturePosting.ownerEmail}`,
        );
      }

      if (!organizationId) {
        throw new Error(
          `Missing fixture organization for posting seed: ${fixturePosting.ownerEmail}`,
        );
      }

      const { pausedAt, publishedAt } = buildLifecycleTimestamps(
        index + 1,
        fixturePosting.status,
      );

      await prisma.posting.upsert({
        where: {
          id: fixturePosting.id,
        },
        update: {
          ownerId,
          organizationId,
          status: fixturePosting.status,
          family: fixturePosting.family,
          subtype: fixturePosting.subtype,
          name: fixturePosting.name,
          description: fixturePosting.description,
          pricingCurrency: fixturePosting.pricingCurrency,
          pricing: fixturePosting.pricing as never,
          tags: fixturePosting.tags as never,
          ...toPostingDetailsColumns(
            fixturePosting.family,
            fixturePosting.details,
          ),
          availabilityStatus: fixturePosting.availabilityStatus,
          availabilityNotes: fixturePosting.availabilityNotes ?? null,
          maxBookingDurationDays: fixturePosting.maxBookingDurationDays ?? null,
          latitude: fixturePosting.latitude,
          longitude: fixturePosting.longitude,
          city: fixturePosting.city,
          region: fixturePosting.region,
          country: fixturePosting.country,
          postalCode: fixturePosting.postalCode ?? null,
          publishedAt,
          pausedAt,
          archivedAt: null,
        },
        create: {
          id: fixturePosting.id,
          ownerId,
          organizationId,
          status: fixturePosting.status,
          family: fixturePosting.family,
          subtype: fixturePosting.subtype,
          name: fixturePosting.name,
          description: fixturePosting.description,
          pricingCurrency: fixturePosting.pricingCurrency,
          pricing: fixturePosting.pricing as never,
          tags: fixturePosting.tags as never,
          ...toPostingDetailsColumns(
            fixturePosting.family,
            fixturePosting.details,
          ),
          availabilityStatus: fixturePosting.availabilityStatus,
          availabilityNotes: fixturePosting.availabilityNotes ?? null,
          maxBookingDurationDays: fixturePosting.maxBookingDurationDays ?? null,
          latitude: fixturePosting.latitude,
          longitude: fixturePosting.longitude,
          city: fixturePosting.city,
          region: fixturePosting.region,
          country: fixturePosting.country,
          postalCode: fixturePosting.postalCode ?? null,
          publishedAt,
          pausedAt,
          archivedAt: null,
        },
      });

      state.postingOwnerIdsByPostingId.set(fixturePosting.id, ownerId);
    }

    await prisma.postingPhoto.deleteMany({
      where: {
        postingId: {
          in: SEED_POSTINGS.map((posting) => posting.id),
        },
      },
    });

    await prisma.postingAvailabilityBlock.deleteMany({
      where: {
        postingId: {
          in: SEED_POSTINGS.map((posting) => posting.id),
        },
        source: "owner",
      },
    });

    for (const posting of SEED_POSTINGS) {
      for (const photo of posting.photos) {
        await prisma.postingPhoto.create({
          data: {
            id: photo.id,
            postingId: posting.id,
            blobUrl: photo.blobUrl,
            blobName: photo.blobName,
            thumbnailBlobUrl: photo.thumbnailBlobUrl ?? null,
            thumbnailBlobName: photo.thumbnailBlobName ?? null,
            position: photo.position,
          },
        });
      }

      for (const block of posting.availabilityBlocks) {
        await prisma.postingAvailabilityBlock.create({
          data: {
            id: block.id,
            postingId: posting.id,
            startAt: new Date(block.startAt),
            endAt: new Date(block.endAt),
            note: block.note ?? null,
            source: block.source,
          },
        });
      }
    }

    await syncOwnerProfilePostingCounts(state.userIdsByEmail, prisma);
    logger.info(
      `Seeded ${SEED_POSTINGS.length} postings with photos and owner availability.`,
    );
  },
};
