import { PostingsRepository } from "@/features/postings/postings.repository";

function createPostingPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    ownerId: "owner-1",
    organizationId: "org-1",
    status: "published",
    family: "place",
    subtype: "entire_place",
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricingCurrency: "CAD",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    tags: ["loft", "workspace"],
    placeDetails: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    equipmentDetails: null,
    vehicleDetails: null,
    availabilityStatus: "available",
    availabilityNotes: null,
    maxBookingDurationDays: null,
    latitude: 43.6532,
    longitude: -79.3832,
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "M5H 2N2",
    photos: [
      {
        id: "photo-1",
        blobUrl: "https://example.test/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        thumbnailBlobUrl: "https://example.test/photo-1.webp",
        thumbnailBlobName: "postings/thumbnails/photo-1.webp",
        position: 0,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ],
    availabilityBlocks: [
      {
        id: "block-1",
        postingId: "posting-1",
        startAt: new Date("2026-05-21T00:00:00.000Z"),
        endAt: new Date("2026-05-22T00:00:00.000Z"),
        note: "Owner stay",
        source: "owner",
        bookingRequestHold: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ],
    bookingRequests: [
      {
        id: "booking-1",
        status: "pending",
        startAt: new Date("2026-05-23T00:00:00.000Z"),
        endAt: new Date("2026-05-24T00:00:00.000Z"),
        holdExpiresAt: new Date("2026-05-25T00:00:00.000Z"),
        convertedAt: null,
        conversionReservationExpiresAt: null,
      },
    ],
    rentings: [
      {
        id: "renting-1",
        startAt: new Date("2026-05-26T00:00:00.000Z"),
        endAt: new Date("2026-05-27T00:00:00.000Z"),
      },
    ],
    publishedAt: new Date("2026-05-01T00:00:00.000Z"),
    pausedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function createSearchOutboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    postingId: "posting-1",
    reindexRunId: null,
    operation: "upsert",
    dedupeKey: "outbox-1",
    targetIndexName: null,
    attempts: 0,
    publishAttempts: 0,
    availableAt: new Date("2026-05-20T12:00:00.000Z"),
    processingAt: null,
    processedAt: null,
    indexedAt: null,
    deadLetteredAt: null,
    brokerMessageId: null,
    lastError: null,
    createdAt: new Date("2026-05-20T12:00:00.000Z"),
    updatedAt: new Date("2026-05-20T12:00:00.000Z"),
    ...overrides,
  };
}

describe("PostingsRepository", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists owner postings with mapped records and pagination", async () => {
    const findMany = jest.fn(async () => [createPostingPersistence()]);
    const count = jest.fn(async () => 3);
    const repository = new PostingsRepository({
      posting: {
        findMany,
        count,
      },
    } as never);

    const result = await repository.listByOwner({
      organizationId: "org-1",
      page: 2,
      pageSize: 2,
      status: "published",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          status: "published",
        },
        skip: 2,
        take: 2,
      }),
    );
    expect(result.postings[0]).toMatchObject({
      id: "posting-1",
      organizationId: "org-1",
      variant: {
        family: "place",
        subtype: "entire_place",
      },
      effectiveMaxBookingDurationDays: 30,
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(result.status).toBe("published");
  });

  it("returns ordered public batches with missing ids preserved", async () => {
    const findMany = jest.fn(async () => [
      createPostingPersistence({
        id: "posting-2",
      }),
      createPostingPersistence({
        id: "posting-1",
      }),
    ]);
    const repository = new PostingsRepository({
      posting: {
        findMany,
      },
    } as never);

    const result = await repository.batchFindPublic({
      ids: ["posting-1", "posting-3", "posting-2"],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["posting-1", "posting-3", "posting-2"],
          },
          status: "published",
          archivedAt: null,
        },
      }),
    );
    expect(result.postings.map((posting) => posting.id)).toEqual([
      "posting-1",
      "posting-2",
    ]);
    expect(result.missingIds).toEqual(["posting-3"]);
  });

  it("creates owner availability blocks and enqueues a search outbox sync", async () => {
    const transaction = {
      postingAvailabilityBlock: {
        create: jest.fn(async () => ({
          id: "block-1",
          postingId: "posting-1",
          startAt: new Date("2026-06-01T00:00:00.000Z"),
          endAt: new Date("2026-06-03T00:00:00.000Z"),
          note: "Maintenance",
          source: "owner",
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          updatedAt: new Date("2026-05-20T12:00:00.000Z"),
        })),
      },
      searchReindexRun: {
        findFirst: jest.fn(async () => null),
      },
      postingSearchOutbox: {
        createMany: jest.fn(async () => undefined),
      },
    };
    const repository = new PostingsRepository({
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as never);

    const result = await repository.createOwnerAvailabilityBlock("posting-1", {
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-03T00:00:00.000Z",
      note: "Maintenance",
    });

    expect(transaction.postingAvailabilityBlock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingId: "posting-1",
          note: "Maintenance",
          source: "owner",
        }),
      }),
    );
    expect(transaction.postingSearchOutbox.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            postingId: "posting-1",
            operation: "upsert",
          }),
        ],
      }),
    );
    expect(result).toEqual({
      id: "block-1",
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-03T00:00:00.000Z",
      note: "Maintenance",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });
  });

  it("checks owner-block, booking, and renting conflicts with the expected overlap filters", async () => {
    const postingAvailabilityBlockFindFirst = jest.fn(async () => ({
      id: "block-1",
    }));
    const bookingRequestFindFirst = jest.fn(async () => ({
      id: "booking-1",
    }));
    const rentingFindFirst = jest.fn(async () => ({
      id: "renting-1",
    }));
    const repository = new PostingsRepository({
      postingAvailabilityBlock: {
        findFirst: postingAvailabilityBlockFindFirst,
      },
      bookingRequest: {
        findFirst: bookingRequestFindFirst,
      },
      renting: {
        findFirst: rentingFindFirst,
      },
    } as never);
    const startAt = new Date("2026-06-01T00:00:00.000Z");
    const endAt = new Date("2026-06-03T00:00:00.000Z");

    await expect(
      repository.hasOwnerAvailabilityBlockOverlap({
        postingId: "posting-1",
        startAt,
        endAt,
        excludeBlockId: "block-2",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.hasActiveBookingAvailabilityConflict({
        postingId: "posting-1",
        startAt,
        endAt,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.hasRentingAvailabilityConflict({
        postingId: "posting-1",
        startAt,
        endAt,
      }),
    ).resolves.toBe(true);

    expect(postingAvailabilityBlockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            not: "block-2",
          },
          startAt: {
            lt: endAt,
          },
          endAt: {
            gt: startAt,
          },
        }),
      }),
    );
    expect(bookingRequestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          postingId: "posting-1",
          startAt: {
            lt: endAt,
          },
          endAt: {
            gt: startAt,
          },
        }),
      }),
    );
    expect(rentingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          postingId: "posting-1",
          startAt: {
            lt: endAt,
          },
          endAt: {
            gt: startAt,
          },
        },
        select: {
          id: true,
        },
      }),
    );
  });

  it("claims search outbox jobs in FIFO order and maps processing timestamps", async () => {
    const transaction = {
      $queryRaw: jest.fn(async () => [
        {
          id: "outbox-1",
        },
        {
          id: "outbox-2",
        },
      ]),
      postingSearchOutbox: {
        updateMany: jest.fn(async () => undefined),
        findMany: jest.fn(async () => [
          createSearchOutboxRow({
            id: "outbox-2",
            postingId: "posting-2",
          }),
          createSearchOutboxRow(),
        ]),
      },
    };
    const repository = new PostingsRepository({
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as never);

    const result = await repository.claimSearchOutboxBatch(2);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.postingSearchOutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["outbox-1", "outbox-2"],
        },
      },
      data: {
        processingAt: new Date("2026-05-20T12:00:00.000Z"),
      },
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: "outbox-1",
        postingId: "posting-1",
        processingAt: "2026-05-20T12:00:00.000Z",
      }),
      expect.objectContaining({
        id: "outbox-2",
        postingId: "posting-2",
        processingAt: "2026-05-20T12:00:00.000Z",
      }),
    ]);
  });

  it("maps reindex catch-up states across missing, waiting, dead-lettered, and caught-up barriers", async () => {
    const searchReindexRunFindUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        barrierOutboxId: "barrier-1",
      })
      .mockResolvedValueOnce({
        barrierOutboxId: "barrier-2",
      })
      .mockResolvedValueOnce({
        barrierOutboxId: "barrier-3",
      });
    const postingSearchOutboxFindUnique = jest
      .fn()
      .mockResolvedValueOnce({
        createdAt: new Date("2026-05-20T11:00:00.000Z"),
        indexedAt: null,
        deadLetteredAt: null,
        lastError: null,
      })
      .mockResolvedValueOnce({
        createdAt: new Date("2026-05-20T11:00:00.000Z"),
        indexedAt: null,
        deadLetteredAt: new Date("2026-05-20T11:30:00.000Z"),
        lastError: "consumer failed",
      })
      .mockResolvedValueOnce({
        createdAt: new Date("2026-05-20T11:00:00.000Z"),
        indexedAt: new Date("2026-05-20T11:10:00.000Z"),
        deadLetteredAt: null,
        lastError: null,
      });
    const postingSearchOutboxCount = jest.fn().mockResolvedValueOnce(0);
    const repository = new PostingsRepository({
      searchReindexRun: {
        findUnique: searchReindexRunFindUnique,
      },
      postingSearchOutbox: {
        findUnique: postingSearchOutboxFindUnique,
        count: postingSearchOutboxCount,
      },
    } as never);

    await expect(
      repository.getSearchReindexCatchUpState("run-1"),
    ).resolves.toEqual({
      state: "failed",
      errorMessage:
        "Search reindex run is missing its barrier outbox reference.",
    });
    await expect(
      repository.getSearchReindexCatchUpState("run-2"),
    ).resolves.toEqual({
      state: "waiting",
    });
    await expect(
      repository.getSearchReindexCatchUpState("run-3"),
    ).resolves.toEqual({
      state: "failed",
      errorMessage:
        "Search reindex barrier could not complete: consumer failed",
    });
    await expect(
      repository.getSearchReindexCatchUpState("run-4"),
    ).resolves.toEqual({
      state: "caught_up",
    });
  });

  it("reads and updates posting photo thumbnails", async () => {
    const findFirst = jest.fn(async () => ({
      id: "photo-1",
      blobUrl: "https://example.test/photo-1.jpg",
      blobName: "postings/photo-1.jpg",
      thumbnailBlobUrl: null,
      thumbnailBlobName: null,
      position: 0,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    }));
    const update = jest.fn(async () => undefined);
    const repository = new PostingsRepository({
      postingPhoto: {
        findFirst,
        update,
      },
    } as never);

    await expect(
      repository.findPrimaryPhotoForThumbnailing("posting-1"),
    ).resolves.toEqual({
      id: "photo-1",
      blobUrl: "https://example.test/photo-1.jpg",
      blobName: "postings/photo-1.jpg",
      thumbnailBlobUrl: undefined,
      thumbnailBlobName: undefined,
      position: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    await repository.updatePostingPhotoThumbnail("photo-1", {
      thumbnailBlobName: "postings/thumbnails/photo-1.webp",
      thumbnailBlobUrl: "https://example.test/photo-1.webp",
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "photo-1",
      },
      data: {
        thumbnailBlobName: "postings/thumbnails/photo-1.webp",
        thumbnailBlobUrl: "https://example.test/photo-1.webp",
      },
    });
  });
});
