import { randomUUID } from "node:crypto";
import { buildApiPath } from "@/configuration/http/api-path";
import type { RecommendationActivityEventPayload } from "@/features/recommendations/recommendation-activity.model";
import type { PostingThumbnailJobPayload } from "@/features/postings/thumbnail/thumbnail.model";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { peekRabbitMqMessages } from "../../support/live-rabbitmq";

const POSTING_THUMBNAIL_QUEUE_NAME = "postings.thumbnail.main";
const RECOMMENDATION_ACTIVITY_QUEUE_NAME = "recommendation-activity.main";

async function readQueuePayloads<TPayload>(
  persistenceApp: PersistenceTestApp,
  queueName: string,
  count = 25,
): Promise<TPayload[]> {
  return (
    await peekRabbitMqMessages<TPayload>(
      persistenceApp.infra.rabbitMq,
      queueName,
      count,
    )
  ).map((message) => message.payload);
}

function buildPostingPhoto(blobName: string) {
  return {
    blobUrl: `http://blob.test/uploads/${blobName}?blobName=${blobName}`,
    blobName,
    position: 0,
  };
}

function buildCreatePostingBody() {
  return {
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Persistence Test Workspace",
    description:
      "Bright loft prepared for persistence-backed integration tests.",
    pricing: {
      currency: "cad",
      daily: {
        amount: 155,
      },
      hourly: {
        amount: 32,
      },
    },
    photos: [buildPostingPhoto("postings/persistence-workspace.jpg")],
    tags: ["Loft", "Workspace", "Test"],
    details: {
      guest_capacity: 6,
      bedrooms: 0,
      bathrooms: 1,
      property_type: "loft",
      amenities: ["wifi", "whiteboard"],
      pet_friendly: false,
      parking: true,
    },
    availabilityStatus: "available",
    availabilityNotes: "Open on weekdays.",
    maxBookingDurationDays: 12,
    minBookingDurationDays: 2,
    advanceNoticeDays: 1,
    cancellationPolicy: "moderate",
    cancellationPolicyNotes: "Two days notice preferred.",
    instantBooking: true,
    availabilityBlocks: [
      {
        startAt: "2026-10-02T14:00:00.000Z",
        endAt: "2026-10-03T14:00:00.000Z",
        note: "Reserved for a photo shoot.",
      },
    ],
    location: {
      latitude: 43.6511,
      longitude: -79.347,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5A1A1",
    },
  };
}

function buildUpdatePostingBody() {
  return {
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Persistence Test Workspace Updated",
    description: "Updated description after the draft is persisted.",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 175,
      },
      weekly: {
        amount: 960,
      },
    },
    photos: [buildPostingPhoto("postings/persistence-workspace-updated.jpg")],
    tags: ["updated", "workspace"],
    details: {
      guest_capacity: 8,
      bedrooms: 0,
      bathrooms: 1,
      property_type: "studio",
      amenities: ["wifi", "projector"],
      pet_friendly: false,
      parking: false,
    },
    availabilityStatus: "limited",
    availabilityNotes: "Now limited to weekday afternoons.",
    maxBookingDurationDays: 10,
    minBookingDurationDays: 3,
    advanceNoticeDays: 2,
    cancellationPolicy: "strict",
    cancellationPolicyNotes: "No same-day cancellations.",
    instantBooking: false,
    location: {
      latitude: 43.7001,
      longitude: -79.4012,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M4B1B3",
    },
  };
}

async function findEligibleReviewScenario(persistenceApp: PersistenceTestApp) {
  const completedRentings = await persistenceApp.prisma.renting.findMany({
    where: {
      status: "completed",
    },
    include: {
      renter: true,
      posting: {
        include: {
          organization: {
            include: {
              memberships: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const eligibleRenting = completedRentings.find(
    (renting) =>
      !renting.posting.organization.memberships.some(
        (membership) => membership.userId === renting.renterId,
      ),
  );

  if (eligibleRenting) {
    return eligibleRenting;
  }

  const posting = await persistenceApp.prisma.posting.findUniqueOrThrow({
    where: {
      id: SEED_POSTINGS[0]!.id,
    },
    include: {
      organization: {
        include: {
          memberships: true,
        },
      },
    },
  });
  const renter = await persistenceApp.prisma.user.findUniqueOrThrow({
    where: {
      email: "viewer1@rentify.local",
    },
  });
  const pricing = posting.pricing as {
    daily?: {
      amount?: number;
    };
  };
  const dailyPriceAmount = Number(pricing.daily?.amount ?? 0);
  const durationDays = 2;
  const bookingRequestId = randomUUID();
  const rentingId = randomUUID();
  const completedAt = new Date("2026-07-04T12:00:00.000Z");

  await persistenceApp.prisma.bookingRequest.create({
    data: {
      id: bookingRequestId,
      postingId: posting.id,
      renterId: renter.id,
      organizationId: posting.organizationId,
      status: "paid",
      startAt: new Date("2026-07-01T12:00:00.000Z"),
      endAt: new Date("2026-07-03T12:00:00.000Z"),
      durationDays,
      guestCount: 2,
      contactName: "Viewer One",
      contactEmail: renter.email,
      note: "Completed stay for review eligibility.",
      pricingCurrency: posting.pricingCurrency,
      pricingSnapshot: posting.pricing as any,
      dailyPriceAmount,
      estimatedTotal: dailyPriceAmount * durationDays,
      approvedAt: new Date("2026-06-28T12:00:00.000Z"),
      paymentRequiredAt: new Date("2026-06-29T12:00:00.000Z"),
      holdExpiresAt: new Date("2026-06-30T12:00:00.000Z"),
      convertedAt: new Date("2026-06-30T18:00:00.000Z"),
    },
  });
  await persistenceApp.prisma.renting.create({
    data: {
      id: rentingId,
      postingId: posting.id,
      bookingRequestId,
      renterId: renter.id,
      organizationId: posting.organizationId,
      status: "completed",
      startAt: new Date("2026-07-01T12:00:00.000Z"),
      endAt: new Date("2026-07-03T12:00:00.000Z"),
      durationDays,
      guestCount: 2,
      pricingCurrency: posting.pricingCurrency,
      pricingSnapshot: posting.pricing as any,
      dailyPriceAmount,
      estimatedTotal: dailyPriceAmount * durationDays,
      confirmedAt: new Date("2026-06-30T18:00:00.000Z"),
      pickupInstructions: "Meet at the front desk.",
      returnInstructions: "Leave keys with the concierge.",
      checkInReadyAt: new Date("2026-07-01T10:00:00.000Z"),
      checkInCompletedAt: new Date("2026-07-01T12:30:00.000Z"),
      returnDueAt: new Date("2026-07-03T12:00:00.000Z"),
      completedAt,
    },
  });

  return persistenceApp.prisma.renting.findUniqueOrThrow({
    where: {
      id: rentingId,
    },
    include: {
      renter: true,
      posting: {
        include: {
          organization: {
            include: {
              memberships: true,
            },
          },
        },
      },
    },
  });
}

describe("Postings persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("persists posting creation, updates, duplication, and lifecycle transitions", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify(buildCreatePostingBody()),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdPayload = (await createResponse.json()) as {
      data: {
        id: string;
      };
    };
    const createdPostingId = createdPayload.data.id;

    const createdPosting =
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: createdPostingId,
        },
        include: {
          photos: true,
          availabilityBlocks: true,
        },
      });

    expect(createdPosting).toMatchObject({
      id: createdPostingId,
      status: "draft",
      name: "Persistence Test Workspace",
      availabilityStatus: "available",
      minBookingDurationDays: 2,
      advanceNoticeDays: 1,
      instantBooking: true,
    });
    expect(createdPosting.photos).toHaveLength(1);
    expect(createdPosting.photos[0]).toMatchObject({
      blobName: "postings/persistence-workspace.jpg",
    });
    expect(createdPosting.availabilityBlocks).toHaveLength(1);
    expect(createdPosting.availabilityBlocks[0]).toMatchObject({
      source: "owner",
      note: "Reserved for a photo shoot.",
    });

    const updateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${createdPostingId}`)}`,
      {
        method: "PUT",
        headers: owner.headers(),
        body: JSON.stringify(buildUpdatePostingBody()),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedPosting =
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: createdPostingId,
        },
        include: {
          photos: true,
        },
      });
    expect(updatedPosting).toMatchObject({
      name: "Persistence Test Workspace Updated",
      availabilityStatus: "limited",
      minBookingDurationDays: 3,
      cancellationPolicy: "strict",
      instantBooking: false,
      city: "Toronto",
      postalCode: "M4B1B3",
    });
    expect(updatedPosting.photos[0]).toMatchObject({
      blobName: "postings/persistence-workspace-updated.jpg",
    });

    const duplicateSourceId = SEED_POSTINGS[0]!.id;
    const duplicateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${duplicateSourceId}/duplicate`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );

    expect(duplicateResponse.status).toBe(201);
    const duplicatePayload = (await duplicateResponse.json()) as {
      data: {
        id: string;
      };
    };
    const duplicatedPosting =
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: duplicatePayload.data.id,
        },
        include: {
          photos: true,
          availabilityBlocks: true,
        },
      });
    expect(duplicatedPosting).toMatchObject({
      status: "draft",
      name: SEED_POSTINGS[0]!.name,
    });
    expect(duplicatedPosting.photos.length).toBeGreaterThan(0);

    const publishPostingId = SEED_POSTINGS[1]!.id;
    const pausePostingId = SEED_POSTINGS[0]!.id;
    const unpausePostingId = SEED_POSTINGS[4]!.id;
    const archivePostingId = SEED_POSTINGS[5]!.id;

    const publishResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${publishPostingId}/publish`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );
    const pauseResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${pausePostingId}/pause`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );
    const unpauseResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${unpausePostingId}/unpause`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );
    const archiveResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${archivePostingId}/archive`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );

    expect(publishResponse.status).toBe(200);
    expect(pauseResponse.status).toBe(200);
    expect(unpauseResponse.status).toBe(200);
    expect(archiveResponse.status).toBe(200);

    expect(
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: publishPostingId,
        },
      }),
    ).toMatchObject({
      status: "published",
      publishedAt: expect.any(Date),
    });
    expect(
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: pausePostingId,
        },
      }),
    ).toMatchObject({
      status: "paused",
      pausedAt: expect.any(Date),
    });
    expect(
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: unpausePostingId,
        },
      }),
    ).toMatchObject({
      status: "published",
      pausedAt: null,
    });
    expect(
      await persistenceApp.prisma.posting.findUniqueOrThrow({
        where: {
          id: archivePostingId,
        },
      }),
    ).toMatchObject({
      status: "archived",
      archivedAt: expect.any(Date),
    });

    const thumbnailJobs = await readQueuePayloads<PostingThumbnailJobPayload>(
      persistenceApp,
      POSTING_THUMBNAIL_QUEUE_NAME,
      10,
    );
    expect(thumbnailJobs).toHaveLength(5);
    expect(
      thumbnailJobs.filter((job) => job.postingId === createdPostingId),
    ).toHaveLength(2);
    expect(
      thumbnailJobs.filter((job) => job.postingId === duplicatePayload.data.id),
    ).toHaveLength(1);
    expect(
      thumbnailJobs.filter((job) => job.postingId === publishPostingId),
    ).toHaveLength(1);
    expect(
      thumbnailJobs.filter((job) => job.postingId === unpausePostingId),
    ).toHaveLength(1);
    expect(thumbnailJobs.every((job) => job.attempt === 0)).toBe(true);

    const recommendationEvents =
      await readQueuePayloads<RecommendationActivityEventPayload>(
        persistenceApp,
        RECOMMENDATION_ACTIVITY_QUEUE_NAME,
        10,
      );
    expect(recommendationEvents).toHaveLength(4);
    expect(recommendationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          postingId: publishPostingId,
          eventType: "posting_published",
        }),
        expect.objectContaining({
          postingId: pausePostingId,
          eventType: "posting_paused",
        }),
        expect.objectContaining({
          postingId: unpausePostingId,
          eventType: "posting_unpaused",
        }),
        expect.objectContaining({
          postingId: archivePostingId,
          eventType: "posting_archived",
        }),
      ]),
    );
  });

  it("persists availability blocks, seasonal pricing rules, and reviews", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const availabilityPostingId = SEED_POSTINGS[2]!.id;

    const createAvailabilityResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${availabilityPostingId}/availability-blocks`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          startAt: "2026-11-02T15:00:00.000Z",
          endAt: "2026-11-04T15:00:00.000Z",
          note: "Owner vacation.",
        }),
      },
    );

    expect(createAvailabilityResponse.status).toBe(201);
    const createAvailabilityPayload =
      (await createAvailabilityResponse.json()) as {
        data: {
          id: string;
        };
      };
    const availabilityBlockId = createAvailabilityPayload.data.id;

    expect(
      await persistenceApp.prisma.postingAvailabilityBlock.findUniqueOrThrow({
        where: {
          id: availabilityBlockId,
        },
      }),
    ).toMatchObject({
      postingId: availabilityPostingId,
      note: "Owner vacation.",
      source: "owner",
    });

    const updateAvailabilityResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${availabilityPostingId}/availability-blocks/${availabilityBlockId}`)}`,
      {
        method: "PUT",
        headers: owner.headers(),
        body: JSON.stringify({
          startAt: "2026-11-03T15:00:00.000Z",
          endAt: "2026-11-05T15:00:00.000Z",
          note: "Updated owner vacation.",
        }),
      },
    );

    expect(updateAvailabilityResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.postingAvailabilityBlock.findUniqueOrThrow({
        where: {
          id: availabilityBlockId,
        },
      }),
    ).toMatchObject({
      note: "Updated owner vacation.",
    });

    const deleteAvailabilityResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${availabilityPostingId}/availability-blocks/${availabilityBlockId}`)}`,
      {
        method: "DELETE",
        headers: owner.headers(),
      },
    );

    expect(deleteAvailabilityResponse.status).toBe(204);
    expect(
      await persistenceApp.prisma.postingAvailabilityBlock.findUnique({
        where: {
          id: availabilityBlockId,
        },
      }),
    ).toBeNull();

    const seasonalPricingPostingId = SEED_POSTINGS[0]!.id;
    const createRuleResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${seasonalPricingPostingId}/seasonal-pricing`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          name: "Holiday Rush",
          startDate: "2026-12-20",
          endDate: "2026-12-31",
          dailyAmount: 225,
        }),
      },
    );

    expect(createRuleResponse.status).toBe(201);
    const createRulePayload = (await createRuleResponse.json()) as {
      data: {
        id: string;
      };
    };
    const ruleId = createRulePayload.data.id;

    expect(
      await persistenceApp.prisma.postingSeasonalPricing.findUniqueOrThrow({
        where: {
          id: ruleId,
        },
      }),
    ).toMatchObject({
      postingId: seasonalPricingPostingId,
      name: "Holiday Rush",
    });

    const updateRuleResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${seasonalPricingPostingId}/seasonal-pricing/${ruleId}`)}`,
      {
        method: "PATCH",
        headers: owner.headers(),
        body: JSON.stringify({
          name: "Holiday Rush Updated",
          startDate: "2026-12-21",
          endDate: "2027-01-02",
          dailyAmount: 245,
        }),
      },
    );

    expect(updateRuleResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.postingSeasonalPricing.findUniqueOrThrow({
        where: {
          id: ruleId,
        },
      }),
    ).toMatchObject({
      name: "Holiday Rush Updated",
    });

    const deleteRuleResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${seasonalPricingPostingId}/seasonal-pricing/${ruleId}`)}`,
      {
        method: "DELETE",
        headers: owner.headers(),
      },
    );

    expect(deleteRuleResponse.status).toBe(204);
    expect(
      await persistenceApp.prisma.postingSeasonalPricing.findUnique({
        where: {
          id: ruleId,
        },
      }),
    ).toBeNull();

    const eligibleRenting = await findEligibleReviewScenario(persistenceApp);
    const reviewer = await createAuthenticatedRequestContext({
      email: eligibleRenting.renter.email,
    });

    const createReviewResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${eligibleRenting.postingId}/reviews`)}`,
      {
        method: "POST",
        headers: reviewer.headers(),
        body: JSON.stringify({
          rating: 5,
          title: "Great stay",
          comment: "Everything matched the listing.",
        }),
      },
    );

    expect(createReviewResponse.status).toBe(201);
    const createdReview =
      await persistenceApp.prisma.postingReview.findFirstOrThrow({
        where: {
          postingId: eligibleRenting.postingId,
          reviewerId: reviewer.userId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    expect(createdReview).toMatchObject({
      rating: 5,
      title: "Great stay",
      comment: "Everything matched the listing.",
    });

    const updateReviewResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/postings/${eligibleRenting.postingId}/reviews/me`)}`,
      {
        method: "PUT",
        headers: reviewer.headers(),
        body: JSON.stringify({
          rating: 4,
          title: "Updated review",
          comment: "The handoff was smooth and the space was clean.",
        }),
      },
    );

    expect(updateReviewResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.postingReview.findUniqueOrThrow({
        where: {
          postingId_reviewerId: {
            postingId: eligibleRenting.postingId,
            reviewerId: reviewer.userId,
          },
        },
      }),
    ).toMatchObject({
      rating: 4,
      title: "Updated review",
      comment: "The handoff was smooth and the space was clean.",
    });
  });

  it("does not persist invalid or forbidden posting writes", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const operator = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });
    const beforeCount = await persistenceApp.prisma.posting.count();

    const invalidCreateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          ...buildCreatePostingBody(),
          photos: [],
        }),
      },
    );

    expect(invalidCreateResponse.status).toBe(400);
    expect(await persistenceApp.prisma.posting.count()).toBe(beforeCount);

    const forbiddenCreateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: operator.headers(),
        body: JSON.stringify(buildCreatePostingBody()),
      },
    );

    expect(forbiddenCreateResponse.status).toBe(403);
    expect(await persistenceApp.prisma.posting.count()).toBe(beforeCount);
  });
});
