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

  async function request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function readData<TData>(response: Response): Promise<TData> {
    const body = (await response.json()) as { data: TData };
    return body.data;
  }

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

    const ownReviewPath = buildApiPath(
      `/postings/${eligibleRenting.postingId}/reviews/me`,
    );

    const anonymousOwnReviewResponse = await persistenceApp.app.request(
      `http://rent.test${ownReviewPath}`,
    );
    expect(anonymousOwnReviewResponse.status).toBe(401);

    const eligibleBeforeResponse = await persistenceApp.app.request(
      `http://rent.test${ownReviewPath}`,
      {
        headers: reviewer.headers(),
      },
    );

    expect(eligibleBeforeResponse.status).toBe(200);
    expect((await eligibleBeforeResponse.json()).data).toEqual({
      eligible: true,
      review: null,
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

    // The same lookup now returns the saved review so the client form opens in
    // edit mode with real values instead of a blank rating.
    const ownReviewAfterResponse = await persistenceApp.app.request(
      `http://rent.test${ownReviewPath}`,
      {
        headers: reviewer.headers(),
      },
    );

    expect(ownReviewAfterResponse.status).toBe(200);
    expect((await ownReviewAfterResponse.json()).data).toMatchObject({
      eligible: true,
      review: {
        rating: 4,
        title: "Updated review",
        comment: "The handoff was smooth and the space was clean.",
      },
    });

    // Organization members can read the posting but are never eligible to review it.
    const member = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: {
        id: eligibleRenting.posting.organization.memberships[0]!.userId,
      },
    });
    const memberContext = await createAuthenticatedRequestContext({
      email: member.email,
    });
    const memberOwnReviewResponse = await persistenceApp.app.request(
      `http://rent.test${ownReviewPath}`,
      {
        headers: memberContext.headers(),
      },
    );

    expect(memberOwnReviewResponse.status).toBe(200);
    expect((await memberOwnReviewResponse.json()).data).toEqual({
      eligible: false,
      review: null,
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

  it("serves owner posting lists, summaries, and batch reads", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const stranger = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const ownedPostingId = SEED_POSTINGS[0]!.id;

    const listResponse = await request("/postings/me?page=1&pageSize=10", {
      headers: owner.headers(),
    });
    expect(listResponse.status).toBe(200);
    const list = await readData<{ postings: Array<{ id: string }> }>(
      listResponse,
    );
    expect(list.postings.length).toBeGreaterThan(0);

    // Postings belong to an organization, so "own postings" means postings of
    // the organizations the caller is a member of.
    const memberships =
      await persistenceApp.prisma.organizationMembership.findMany({
        where: { userId: owner.userId },
        select: { organizationId: true },
      });
    const ownedIds = new Set(
      (
        await persistenceApp.prisma.posting.findMany({
          where: {
            organizationId: {
              in: memberships.map((membership) => membership.organizationId),
            },
          },
          select: { id: true },
        })
      ).map((posting) => posting.id),
    );
    // Every returned posting must belong to the caller.
    for (const posting of list.postings) {
      expect(ownedIds.has(posting.id)).toBe(true);
    }

    const summaryResponse = await request("/postings/me/summary", {
      headers: owner.headers(),
    });
    expect(summaryResponse.status).toBe(200);
    const summary = await readData<{
      total: number;
      byStatus: Record<string, number>;
    }>(summaryResponse);
    expect(summary.total).toBe(ownedIds.size);
    expect(
      Object.values(summary.byStatus).reduce((sum, count) => sum + count, 0),
    ).toBe(summary.total);

    const batchResponse = await request(
      `/postings/me/batch?ids=${ownedPostingId}`,
      { headers: owner.headers() },
    );
    expect(batchResponse.status).toBe(200);
    const batch = await readData<{ postings: Array<{ id: string }> }>(
      batchResponse,
    );
    expect(batch.postings.map((posting) => posting.id)).toEqual([
      ownedPostingId,
    ]);

    // Another user's owner batch must not leak this posting.
    const strangerResponse = await request(
      `/postings/me/batch?ids=${ownedPostingId}`,
      { headers: stranger.headers() },
    );
    if (strangerResponse.status === 200) {
      const strangerBatch = await readData<{
        postings: Array<{ id: string }>;
      }>(strangerResponse);
      expect(strangerBatch.postings.map((posting) => posting.id)).not.toContain(
        ownedPostingId,
      );
    } else {
      expect(strangerResponse.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("serves public posting search, detail, and batch reads", async () => {
    const publishedPosting =
      await persistenceApp.prisma.posting.findFirstOrThrow({
        where: { status: "published" },
      });

    const searchResponse = await request(
      "/postings?q=loft&family=place&page=1&pageSize=10",
    );
    expect(searchResponse.status).toBe(200);
    expect(
      persistenceApp.stubs.postingsPublicSearchService.searchPublic,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ query: "loft", family: "place" }),
    );

    const detailResponse = await request(`/postings/${publishedPosting.id}`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { id: publishedPosting.id, status: "published" },
    });

    const batchResponse = await request(
      `/postings/batch?ids=${publishedPosting.id}`,
    );
    expect(batchResponse.status).toBe(200);
    const batch = await readData<{ postings: Array<{ id: string }> }>(
      batchResponse,
    );
    expect(batch.postings.map((posting) => posting.id)).toEqual([
      publishedPosting.id,
    ]);

    const missingResponse = await request(
      `/postings/${"00000000-0000-0000-0000-0000000000ff"}`,
    );
    expect(missingResponse.status).toBe(404);
  });

  it("serves posting reviews, availability, and seasonal pricing reads", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const postingId = SEED_POSTINGS[0]!.id;

    const reviewsResponse = await request(
      `/postings/${postingId}/reviews?page=1&pageSize=10`,
    );
    expect(reviewsResponse.status).toBe(200);
    const reviews = await readData<{ reviews: unknown[] }>(reviewsResponse);
    expect(Array.isArray(reviews.reviews)).toBe(true);

    const calendarResponse = await request(
      `/postings/${postingId}/availability-calendar?year=2027&month=3`,
    );
    expect(calendarResponse.status).toBe(200);

    const blockBody = {
      startAt: "2027-03-01T15:00:00.000Z",
      endAt: "2027-03-05T15:00:00.000Z",
      note: "Owner maintenance",
    };
    const createBlockResponse = await request(
      `/postings/${postingId}/availability-blocks`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify(blockBody),
      },
    );
    expect(createBlockResponse.status).toBe(201);

    const blocksResponse = await request(
      `/postings/${postingId}/availability-blocks`,
      { headers: owner.headers() },
    );
    expect(blocksResponse.status).toBe(200);
    const blocks = await readData<{
      availabilityBlocks: Array<{ note?: string }>;
    }>(blocksResponse);
    expect(
      blocks.availabilityBlocks.some(
        (block) => block.note === "Owner maintenance",
      ),
    ).toBe(true);

    const createRuleResponse = await request(
      `/postings/${postingId}/seasonal-pricing`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          name: "Spring premium",
          startDate: "2027-04-01",
          endDate: "2027-04-30",
          dailyAmount: 210,
        }),
      },
    );
    expect(createRuleResponse.status).toBe(201);

    const rulesResponse = await request(
      `/postings/${postingId}/seasonal-pricing`,
      { headers: owner.headers() },
    );
    expect(rulesResponse.status).toBe(200);
    // Seasonal pricing returns a bare array rather than a wrapper object.
    const rules = await readData<Array<{ name: string }>>(rulesResponse);
    expect(rules.map((rule) => rule.name)).toContain("Spring premium");
  });

  it("serves owner analytics summaries, listings, detail, and CSV export", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const stranger = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const postingId = SEED_POSTINGS[0]!.id;

    const summaryResponse = await request(
      "/postings/analytics/summary?window=7d",
      { headers: owner.headers() },
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      data: { window: "7d", totals: expect.any(Object) },
    });

    const listResponse = await request(
      "/postings/analytics/postings?window=7d&page=1&pageSize=10",
      { headers: owner.headers() },
    );
    expect(listResponse.status).toBe(200);

    const detailResponse = await request(
      `/postings/${postingId}/analytics?window=7d`,
      { headers: owner.headers() },
    );
    expect(detailResponse.status).toBe(200);

    const exportResponse = await request(
      "/postings/analytics/export?window=7d",
      { headers: owner.headers() },
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("csv");
    expect(await exportResponse.text()).not.toHaveLength(0);

    // Analytics for a posting the caller does not own must not be readable.
    const forbiddenResponse = await request(
      `/postings/${postingId}/analytics?window=7d`,
      { headers: stranger.headers() },
    );
    expect(forbiddenResponse.status).toBeGreaterThanOrEqual(400);
  });

  it("accepts a search-click activity event and queues it for the recommender", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const postingId = SEED_POSTINGS[0]!.id;
    const searchSessionId = randomUUID();

    const response = await request(
      `/postings/${postingId}/activity/search-click`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          searchSessionId,
          query: "loft",
          family: "place",
          page: 1,
          position: 0,
          hasGeoFilter: true,
          hasAvailabilityFilter: false,
        }),
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: true },
    });

    const payloads = await readQueuePayloads<RecommendationActivityEventPayload>(
      persistenceApp,
      RECOMMENDATION_ACTIVITY_QUEUE_NAME,
    );
    expect(
      payloads.some(
        (payload) =>
          payload.postingId === postingId &&
          payload.eventType === "search_click",
      ),
    ).toBe(true);
  });
});
