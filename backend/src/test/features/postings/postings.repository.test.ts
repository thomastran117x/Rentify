import { Prisma } from "@prisma/client";
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

function createSearchReindexRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "pending",
    targetIndexName: "postings-reindex-1",
    retainedIndexName: null,
    sourceSnapshotAt: new Date("2026-05-20T10:00:00.000Z"),
    barrierOutboxId: null,
    totalPostings: 0,
    indexedPostings: 0,
    failedPostings: 0,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    processingAt: null,
    lastError: null,
    createdAt: new Date("2026-05-20T10:00:00.000Z"),
    updatedAt: new Date("2026-05-20T10:00:00.000Z"),
    ...overrides,
  };
}

function createUpsertPostingInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    photos: [
      {
        blobUrl: "https://example.test/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
      },
    ],
    tags: ["loft", "workspace"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    availabilityNotes: "Open for bookings",
    maxBookingDurationDays: 14,
    availabilityBlocks: [
      {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
        note: "Owner stay",
      },
    ],
    location: {
      latitude: 43.6532,
      longitude: -79.3832,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5H 2N2",
    },
    ...overrides,
  } as any;
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
    } as any);

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

  it("filters owner postings by a search query", async () => {
    const findMany = jest.fn(async () => [createPostingPersistence()]);
    const count = jest.fn(async () => 1);
    const repository = new PostingsRepository({
      posting: {
        findMany,
        count,
      },
    } as any);

    await repository.listByOwner({
      organizationId: "org-1",
      page: 1,
      pageSize: 10,
      q: "studio",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          OR: [
            { name: { contains: "studio" } },
            { description: { contains: "studio" } },
          ],
        },
      }),
    );
  });

  it("counts owner postings grouped by status", async () => {
    const groupBy = jest.fn(async () => [
      { status: "draft", _count: { _all: 2 } },
      { status: "published", _count: { _all: 3 } },
      { status: "archived", _count: { _all: 1 } },
    ]);
    const repository = new PostingsRepository({
      posting: {
        groupBy,
      },
    } as any);

    const summary = await repository.countByOwnerStatus("org-1");

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["status"],
        where: { organizationId: "org-1" },
      }),
    );
    expect(summary).toEqual({
      total: 6,
      byStatus: { draft: 2, published: 3, paused: 0, archived: 1 },
    });
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
    } as any);

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
    } as any);

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
    } as any);
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
    } as any);

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
    } as any);

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
    } as any);

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

  it("creates draft postings and enqueues live and reindex delete jobs", async () => {
    const transaction = {
      posting: {
        create: jest.fn(async () =>
          createPostingPersistence({
            status: "draft",
            publishedAt: null,
          }),
        ),
      },
      searchReindexRun: {
        findFirst: jest.fn(async () => ({
          id: "run-1",
          targetIndexName: "postings-reindex-1",
        })),
      },
      postingSearchOutbox: {
        createMany: jest.fn(async () => undefined),
      },
    };
    const repository = new PostingsRepository({
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as any);

    const result = await repository.create(createUpsertPostingInput());

    expect(transaction.posting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "draft",
          family: "place",
          subtype: "entire_place",
          placeDetails: expect.objectContaining({
            guest_capacity: 4,
            property_type: "loft",
          }),
          equipmentDetails: Prisma.DbNull,
          vehicleDetails: Prisma.DbNull,
          photos: {
            create: [
              expect.objectContaining({
                blobUrl: "https://example.test/photo-1.jpg",
                position: 0,
              }),
            ],
          },
          availabilityBlocks: {
            create: [
              expect.objectContaining({
                note: "Owner stay",
                source: "owner",
              }),
            ],
          },
        }),
      }),
    );
    expect(transaction.postingSearchOutbox.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            postingId: "posting-1",
            operation: "delete",
          }),
          expect.objectContaining({
            postingId: "posting-1",
            reindexRunId: "run-1",
            operation: "delete",
            targetIndexName: "postings-reindex-1",
          }),
        ]),
      }),
    );
    expect(result.status).toBe("draft");
  });

  it("updates postings while preserving existing thumbnails for unchanged photos", async () => {
    const transaction = {
      posting: {
        findUnique: jest.fn(async () => ({
          photos: [
            {
              blobUrl: "https://example.test/photo-1.jpg",
              blobName: "postings/photo-1.jpg",
              thumbnailBlobUrl: "https://example.test/photo-1.webp",
              thumbnailBlobName: "postings/thumbnails/photo-1.webp",
            },
          ],
        })),
        update: jest.fn(async () =>
          createPostingPersistence({
            status: "published",
          }),
        ),
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
    } as any);

    const result = await repository.update(
      "posting-1",
      createUpsertPostingInput({
        photos: [
          {
            blobUrl: "https://example.test/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
        ],
      }),
    );

    expect(transaction.posting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "posting-1",
        },
        data: expect.objectContaining({
          photos: {
            deleteMany: {},
            create: [
              expect.objectContaining({
                thumbnailBlobName: "postings/thumbnails/photo-1.webp",
                thumbnailBlobUrl: "https://example.test/photo-1.webp",
              }),
            ],
          },
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
    expect(result?.status).toBe("published");
  });

  it("returns null when updating a missing posting", async () => {
    const transaction = {
      posting: {
        findUnique: jest.fn(async () => null),
      },
    };
    const repository = new PostingsRepository({
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as any);

    await expect(
      repository.update("missing-posting", createUpsertPostingInput()),
    ).resolves.toBeNull();
  });

  it("maps publish, archive, pause, and unpause transitions into the expected outbox operations", async () => {
    const createLifecycleRepository = (updated: Record<string, unknown>) => {
      const transaction = {
        posting: {
          update: jest.fn(async () => createPostingPersistence(updated)),
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
      } as any);

      return {
        repository,
        transaction,
      };
    };

    const publishCase = createLifecycleRepository({
      status: "published",
      publishedAt: new Date("2026-05-20T12:00:00.000Z"),
      pausedAt: null,
      archivedAt: null,
    });
    const archiveCase = createLifecycleRepository({
      status: "archived",
      archivedAt: new Date("2026-05-20T12:00:00.000Z"),
      pausedAt: null,
    });
    const pauseCase = createLifecycleRepository({
      status: "paused",
      pausedAt: new Date("2026-05-20T12:00:00.000Z"),
      archivedAt: null,
    });
    const unpauseCase = createLifecycleRepository({
      status: "published",
      publishedAt: new Date("2026-05-01T00:00:00.000Z"),
      pausedAt: null,
      archivedAt: null,
    });

    await expect(
      publishCase.repository.publish("posting-1"),
    ).resolves.toMatchObject({
      status: "published",
    });
    await expect(
      archiveCase.repository.archive("posting-1"),
    ).resolves.toMatchObject({
      status: "archived",
    });
    await expect(
      pauseCase.repository.pause("posting-1"),
    ).resolves.toMatchObject({
      status: "paused",
    });
    await expect(
      unpauseCase.repository.unpause("posting-1"),
    ).resolves.toMatchObject({
      status: "published",
    });

    expect(publishCase.transaction.posting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "published",
          pausedAt: null,
          archivedAt: null,
        }),
      }),
    );
    expect(archiveCase.transaction.posting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "archived",
        }),
      }),
    );
    expect(pauseCase.transaction.posting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "paused",
        }),
      }),
    );
    expect(unpauseCase.transaction.posting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "published",
          pausedAt: null,
          archivedAt: null,
        }),
      }),
    );
    expect(
      publishCase.transaction.postingSearchOutbox.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            operation: "upsert",
          }),
        ],
      }),
    );
    expect(
      archiveCase.transaction.postingSearchOutbox.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            operation: "delete",
          }),
        ],
      }),
    );
    expect(
      pauseCase.transaction.postingSearchOutbox.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            operation: "delete",
          }),
        ],
      }),
    );
    expect(
      unpauseCase.transaction.postingSearchOutbox.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            operation: "upsert",
          }),
        ],
      }),
    );
  });

  it("maps direct reads, public metadata, and owner batches with missing ids preserved", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(
        createPostingPersistence({
          status: "paused",
        }),
      )
      .mockResolvedValueOnce({
        id: "posting-1",
        organizationId: "org-1",
        status: "archived",
        archivedAt: new Date("2026-05-20T12:00:00.000Z"),
      });
    const findMany = jest.fn(async () => [
      createPostingPersistence({
        id: "posting-2",
      }),
    ]);
    const repository = new PostingsRepository({
      posting: {
        findUnique,
        findMany,
      },
    } as any);

    await expect(repository.findById("posting-1")).resolves.toMatchObject({
      id: "posting-1",
      status: "paused",
    });
    await expect(
      repository.findPublicReadMetadataById("posting-1"),
    ).resolves.toEqual({
      id: "posting-1",
      organizationId: "org-1",
      status: "archived",
      archivedAt: "2026-05-20T12:00:00.000Z",
    });
    await expect(
      repository.batchFindByOwner({
        organizationId: "org-1",
        ids: ["posting-3", "posting-2"],
      }),
    ).resolves.toEqual({
      postings: [
        expect.objectContaining({
          id: "posting-2",
        }),
      ],
      missingIds: ["posting-3"],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          id: {
            in: ["posting-3", "posting-2"],
          },
        },
      }),
    );
  });

  it("maps autocomplete fallback rows, including invalid tag payloads", async () => {
    const queryRaw = jest.fn(async () => [
      {
        id: "posting-1",
        name: "Sunny loft",
        tags: '["wifi","desk"]',
        city: "Toronto",
        region: "Ontario",
        country: "Canada",
        publishedAt: new Date("2026-05-01T00:00:00.000Z"),
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "posting-2",
        name: "Broken tags",
        tags: "not-json",
        city: null,
        region: null,
        country: null,
        publishedAt: null,
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);
    const repository = new PostingsRepository({
      $queryRaw: queryRaw,
    } as any);

    await expect(
      repository.autocompletePublicFallback({
        query: "LoFt",
        family: "place",
        subtype: "entire_place",
        limit: 5,
      }),
    ).resolves.toEqual([
      {
        name: "Sunny loft",
        tags: ["wifi", "desk"],
        location: {
          city: "Toronto",
          region: "Ontario",
          country: "Canada",
        },
        publishedAt: "2026-05-01T00:00:00.000Z",
        createdAt: "2026-04-01T00:00:00.000Z",
      },
      {
        name: "Broken tags",
        tags: [],
        location: {},
        createdAt: "2026-04-02T00:00:00.000Z",
      },
    ]);

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("maps indexing documents, searchable attributes, and blocked ranges", async () => {
    const posting = createPostingPersistence({
      organization: {
        id: "org-1",
        name: "North Studio",
      },
      availabilityBlocks: [
        {
          id: "block-open",
          postingId: "posting-1",
          startAt: new Date("2026-05-21T00:00:00.000Z"),
          endAt: new Date("2026-05-22T00:00:00.000Z"),
          note: "Owner stay",
          source: "owner",
          bookingRequestHold: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
        {
          id: "block-held",
          postingId: "posting-1",
          startAt: new Date("2026-05-23T00:00:00.000Z"),
          endAt: new Date("2026-05-24T00:00:00.000Z"),
          note: "Paid hold",
          source: "owner",
          bookingRequestHold: {
            id: "booking-hold",
            status: "paid",
            holdExpiresAt: new Date("2026-05-21T12:00:00.000Z"),
            convertedAt: null,
          },
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
        {
          id: "block-expired",
          postingId: "posting-1",
          startAt: new Date("2026-05-25T00:00:00.000Z"),
          endAt: new Date("2026-05-26T00:00:00.000Z"),
          note: "Expired hold",
          source: "owner",
          bookingRequestHold: {
            id: "booking-expired",
            status: "paid",
            holdExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
            convertedAt: null,
          },
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      ],
      bookingRequests: [
        {
          id: "booking-include",
          status: "pending",
          startAt: new Date("2026-05-27T00:00:00.000Z"),
          endAt: new Date("2026-05-28T00:00:00.000Z"),
          holdExpiresAt: new Date("2026-05-22T12:00:00.000Z"),
          convertedAt: null,
          conversionReservationExpiresAt: null,
        },
        {
          id: "booking-reserved",
          status: "awaiting_payment",
          startAt: new Date("2026-05-29T00:00:00.000Z"),
          endAt: new Date("2026-05-30T00:00:00.000Z"),
          holdExpiresAt: new Date("2026-05-22T12:00:00.000Z"),
          convertedAt: null,
          conversionReservationExpiresAt: new Date("2026-05-21T12:00:00.000Z"),
        },
      ],
    });
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([posting])
      .mockResolvedValueOnce([posting]);
    const repository = new PostingsRepository({
      posting: {
        findMany,
      },
    } as any);

    await expect(repository.findByIdsForIndexing([])).resolves.toEqual([]);
    await expect(
      repository.findByIdsForIndexing(["posting-1"]),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "posting-1",
        searchableAttributes: {
          guest_capacity: 4,
          property_type: "loft",
          amenities: ["wifi"],
        },
        blockedRanges: [
          expect.objectContaining({
            source: "availability_block",
            startAt: "2026-05-21T00:00:00.000Z",
          }),
          expect.objectContaining({
            source: "availability_block",
            startAt: "2026-05-23T00:00:00.000Z",
          }),
          expect.objectContaining({
            source: "booking_request",
            startAt: "2026-05-27T00:00:00.000Z",
          }),
          expect.objectContaining({
            source: "renting",
            startAt: "2026-05-26T00:00:00.000Z",
          }),
        ],
      }),
    ]);
    await expect(
      repository.listRecentForIndexReconciliation(5),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "posting-1",
      }),
    ]);

    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 5,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    );
  });

  it("updates outbox publish, retry, dead-letter, lookup, and newer-job state", async () => {
    const update = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        attempts: 3,
      })
      .mockResolvedValueOnce(undefined);
    const findUnique = jest.fn(async () => createSearchOutboxRow());
    const findMany = jest.fn(async () => [
      createSearchOutboxRow({
        id: "outbox-2",
        postingId: "posting-2",
      }),
      createSearchOutboxRow({
        id: "outbox-1",
      }),
    ]);
    const count = jest.fn(async () => 1);
    const repository = new PostingsRepository({
      postingSearchOutbox: {
        update,
        findUnique,
        findMany,
        count,
      },
    } as any);
    const longError = "x".repeat(3000);

    await repository.markSearchOutboxPublished("outbox-1", "broker-1");
    await repository.markSearchOutboxPublishRetry("outbox-1", 20, longError);
    await repository.markSearchOutboxIndexed("outbox-1");
    await expect(
      repository.incrementSearchOutboxAttempt("outbox-1", longError),
    ).resolves.toBe(3);
    await repository.markSearchOutboxDeadLettered("outbox-1", longError);
    await expect(repository.getSearchOutboxById("outbox-1")).resolves.toEqual(
      expect.objectContaining({
        id: "outbox-1",
        postingId: "posting-1",
      }),
    );
    await expect(repository.getSearchOutboxesByIds([])).resolves.toEqual([]);
    await expect(
      repository.getSearchOutboxesByIds(["outbox-1", "outbox-3", "outbox-2"]),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "outbox-1",
      }),
      expect.objectContaining({
        id: "outbox-2",
      }),
    ]);
    await expect(
      repository.hasNewerSearchOutboxJob({
        id: "outbox-1",
        createdAt: "2026-05-20T11:00:00.000Z",
      } as any),
    ).resolves.toBe(false);
    await expect(
      repository.hasNewerSearchOutboxJob({
        id: "outbox-1",
        postingId: "posting-1",
        reindexRunId: "run-1",
        targetIndexName: "postings-reindex-1",
        createdAt: "2026-05-20T11:00:00.000Z",
      }),
    ).resolves.toBe(true);

    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          brokerMessageId: "broker-1",
          processingAt: null,
        }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          publishAttempts: {
            increment: 1,
          },
          lastError: longError.slice(0, 2048),
        }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        data: expect.objectContaining({
          deadLetteredAt: new Date("2026-05-20T12:00:00.000Z"),
          lastError: longError.slice(0, 2048),
        }),
      }),
    );
  });

  it("maps search reindex reads, writes, and claim races", async () => {
    const create = jest.fn(async () =>
      createSearchReindexRunRow({
        id: "run-created",
      }),
    );
    const findUnique = jest.fn(async () =>
      createSearchReindexRunRow({
        id: "run-found",
      }),
    );
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-active",
        }),
      )
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-latest",
        }),
      )
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-completed",
          status: "completed",
          completedAt: new Date("2026-05-20T12:00:00.000Z"),
        }),
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-claim",
          createdAt: new Date("2026-05-19T12:00:00.000Z"),
        }),
      )
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-claim-success",
          createdAt: new Date("2026-05-19T12:00:00.000Z"),
        }),
      );
    const findMany = jest.fn(async () => [
      createSearchReindexRunRow({
        id: "run-retained",
        status: "completed",
        retainedIndexName: "postings-old",
        completedAt: new Date("2026-05-20T12:00:00.000Z"),
      }),
    ]);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({
        count: 0,
      })
      .mockResolvedValueOnce({
        count: 1,
      });
    const update = jest
      .fn()
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-running",
          status: "running",
          totalPostings: 25,
          startedAt: new Date("2026-05-20T12:00:00.000Z"),
          processingAt: new Date("2026-05-20T12:00:00.000Z"),
        }),
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-complete",
          status: "completed",
          retainedIndexName: "postings-20260520",
          completedAt: new Date("2026-05-20T12:00:00.000Z"),
        }),
      )
      .mockResolvedValueOnce(
        createSearchReindexRunRow({
          id: "run-failed",
          status: "failed",
          failedAt: new Date("2026-05-20T12:00:00.000Z"),
          lastError: "boom",
        }),
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const repository = new PostingsRepository({
      searchReindexRun: {
        create,
        findUnique,
        findFirst,
        findMany,
        updateMany,
        update,
      },
    } as any);

    await expect(
      repository.createSearchReindexRun("postings-reindex-2"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-created",
        targetIndexName: "postings-reindex-1",
      }),
    );
    await expect(
      repository.findSearchReindexRunById("run-found"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-found",
      }),
    );
    await expect(repository.findActiveSearchReindexRun()).resolves.toEqual(
      expect.objectContaining({
        id: "run-active",
      }),
    );
    await expect(repository.findLatestSearchReindexRun()).resolves.toEqual(
      expect.objectContaining({
        id: "run-latest",
      }),
    );
    await expect(
      repository.findLatestCompletedSearchReindexRun(),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-completed",
      }),
    );
    await expect(
      repository.listCompletedSearchReindexRunsWithRetainedIndices(),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "run-retained",
        retainedIndexName: "postings-old",
      }),
    ]);
    await expect(repository.claimNextSearchReindexRun()).resolves.toBeNull();
    await expect(repository.claimNextSearchReindexRun()).resolves.toBeNull();
    await expect(repository.claimNextSearchReindexRun()).resolves.toEqual(
      expect.objectContaining({
        id: "run-claim-success",
        processingAt: "2026-05-20T12:00:00.000Z",
      }),
    );
    await expect(
      repository.markSearchReindexRunRunning("run-running", 25),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-running",
        status: "running",
        totalPostings: 25,
      }),
    );
    await repository.updateSearchReindexRunProgress("run-running", {
      indexedPostings: 12,
      failedPostings: 2,
    });
    await expect(
      repository.markSearchReindexRunCompleted(
        "run-complete",
        "postings-20260520",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-complete",
        retainedIndexName: "postings-20260520",
      }),
    );
    await expect(
      repository.markSearchReindexRunFailed("run-failed", "boom"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "run-failed",
        lastError: "boom",
      }),
    );
    await repository.touchSearchReindexRunProcessing("run-touch");
    await repository.clearSearchReindexRunProcessing("run-clear");
    await repository.clearSearchReindexRunRetainedIndexName("run-retained");

    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: "run-claim-success",
        }),
        data: {
          processingAt: new Date("2026-05-20T12:00:00.000Z"),
        },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-retained",
        },
        data: {
          retainedIndexName: null,
        },
      }),
    );
  });

  it("handles indexing batches, outbox relay flows, metrics, and dead-letter revival", async () => {
    const postingFindMany = jest.fn(async () => [createPostingPersistence()]);
    const postingCount = jest.fn(async () => 7);
    const searchOutboxCount = jest.fn(async () => 9);
    const outboxUpdateMany = jest.fn(async () => undefined);
    const queryRaw = jest.fn(async () => [
      {
        unpublishedCount: 4n,
        unpublishedOldestCreatedAt: new Date("2026-05-20T11:59:00.000Z"),
        publishedNotIndexedCount: 3n,
        publishedNotIndexedOldestProcessedAt: new Date(
          "2026-05-20T11:58:00.000Z",
        ),
        upsertDeadLetteredCount: 2n,
        deleteDeadLetteredCount: 1,
        barrierDeadLetteredCount: null,
      },
    ]);
    const relayTransaction = {
      postingSearchOutbox: {
        update: jest.fn(async () => undefined),
        updateMany: jest.fn(async () => undefined),
        findMany: jest.fn().mockResolvedValueOnce([
          {
            id: "dead-1",
          },
          {
            id: "dead-2",
          },
        ]),
      },
    };
    const repository = new PostingsRepository({
      posting: {
        count: postingCount,
        findMany: postingFindMany,
      },
      postingSearchOutbox: {
        count: searchOutboxCount,
        updateMany: outboxUpdateMany,
      },
      $queryRaw: queryRaw,
      $transaction: async (
        callback: (tx: typeof relayTransaction) => Promise<unknown>,
      ) => callback(relayTransaction),
    } as any);

    await expect(
      repository.countPublishedPostingsForIndexing("2026-05-20T12:00:00.000Z"),
    ).resolves.toBe(7);
    await expect(
      repository.listPublishedForIndexingBatch(
        5,
        "posting-10",
        "2026-05-20T12:00:00.000Z",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "posting-1",
      }),
    ]);
    await expect(repository.getPendingSearchOutboxCount()).resolves.toBe(9);
    await expect(repository.getPendingSearchOutboxMetrics()).resolves.toEqual({
      count: 4,
      oldestAgeMs: 60_000,
    });
    await expect(repository.getSearchOutboxLagMetrics()).resolves.toEqual({
      unpublishedCount: 4,
      unpublishedOldestAgeMs: 60_000,
      publishedNotIndexedCount: 3,
      publishedNotIndexedOldestAgeMs: 120_000,
      deadLetteredByOperation: {
        upsert: 2,
        delete: 1,
        barrier: 0,
      },
    });
    await repository.markSearchOutboxesIndexed([]);
    await repository.markSearchOutboxesIndexed(["outbox-1", "outbox-2"]);
    await repository.markSearchOutboxRelayed(
      "outbox-1",
      ["outbox-2"],
      "broker-1",
    );
    await repository.markSearchOutboxSuperseded([], "broker-2");
    await repository.markSearchOutboxSuperseded(["outbox-3"], "broker-2");
    await repository.releaseSearchOutboxClaims([]);
    await repository.releaseSearchOutboxClaims(["outbox-4"], "release failed");
    await expect(repository.reviveDeadLetteredSearchOutbox(0)).resolves.toBe(0);
    await expect(repository.reviveDeadLetteredSearchOutbox(5)).resolves.toBe(2);

    expect(postingCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "published",
          archivedAt: null,
          updatedAt: {
            lte: new Date("2026-05-20T12:00:00.000Z"),
          },
        }),
      }),
    );
    expect(postingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        cursor: {
          id: "posting-10",
        },
        skip: 1,
      }),
    );
    expect(outboxUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["outbox-1", "outbox-2"],
          },
        },
        data: {
          indexedAt: new Date("2026-05-20T12:00:00.000Z"),
          lastError: null,
        },
      }),
    );
    expect(
      relayTransaction.postingSearchOutbox.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ["dead-1", "dead-2"],
          },
        },
        data: expect.objectContaining({
          attempts: 0,
          publishAttempts: 0,
          availableAt: new Date("2026-05-20T12:00:00.000Z"),
        }),
      }),
    );
  });

  it("guards search reindex start locking and releases the mysql lock after successful work", async () => {
    const unlockedRepository = new PostingsRepository({
      $transaction: async (
        callback: (tx: { $queryRaw: typeof jest.fn }) => Promise<unknown>,
      ) =>
        callback({
          $queryRaw: jest.fn(async () => [
            {
              acquired: 0,
            },
          ]) as any,
        } as any),
    } as any);

    await expect(
      unlockedRepository.withSearchReindexStartLock(async () => "nope"),
    ).resolves.toBeNull();

    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          acquired: 1n,
        },
      ])
      .mockResolvedValueOnce([
        {
          released: true,
        },
      ]);
    const create = jest.fn(async () =>
      createSearchReindexRunRow({
        id: "run-locked",
      }),
    );
    const findFirst = jest.fn(async () =>
      createSearchReindexRunRow({
        id: "run-active",
      }),
    );
    const lockedRepository = new PostingsRepository({
      $transaction: async (
        callback: (tx: {
          $queryRaw: typeof queryRaw;
          searchReindexRun: {
            create: typeof create;
            findFirst: typeof findFirst;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          $queryRaw: queryRaw,
          searchReindexRun: {
            create,
            findFirst,
          },
        }),
    } as any);

    await expect(
      lockedRepository.withSearchReindexStartLock(async (helpers) => {
        const active = await helpers.findActiveSearchReindexRun();
        const created = await helpers.createSearchReindexRun(
          "postings-reindex-locked",
        );

        return {
          activeId: active?.id,
          createdId: created.id,
        };
      }),
    ).resolves.toEqual({
      activeId: "run-active",
      createdId: "run-locked",
    });

    expect(queryRaw).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        strings: ["SELECT GET_LOCK(", ", 0) AS acquired"],
        values: ["rentify:search-reindex:start"],
      }),
    );
    expect(queryRaw).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        strings: ["SELECT RELEASE_LOCK(", ") AS released"],
        values: ["rentify:search-reindex:start"],
      }),
    );
  });

  it("restores only owner availability blocks from posting snapshots", async () => {
    const snapshot = {
      id: "posting-1",
      organizationId: "org-1",
      status: "published",
      variant: {
        family: "place",
        subtype: "entire_place",
      },
      name: "Sunny loft",
      description: "Bright loft with workspace",
      pricing: {
        currency: "CAD",
        daily: {
          amount: 150,
        },
      },
      photos: [
        {
          id: "photo-1",
          blobUrl: "https://example.test/photo-1.jpg",
          blobName: "postings/photo-1.jpg",
          thumbnailBlobUrl: "https://example.test/photo-1.webp",
          thumbnailBlobName: "postings/thumbnails/photo-1.webp",
          position: 0,
        },
      ],
      tags: ["loft"],
      details: {
        guest_capacity: 4,
        property_type: "loft",
      },
      availabilityStatus: "available",
      availabilityNotes: null,
      maxBookingDurationDays: null,
      minBookingDurationDays: null,
      advanceNoticeDays: null,
      cancellationPolicy: null,
      cancellationPolicyNotes: null,
      instantBooking: false,
      availabilityBlocks: [
        {
          id: "owner-block",
          startAt: "2026-06-01T00:00:00.000Z",
          endAt: "2026-06-02T00:00:00.000Z",
          note: "Owner stay",
          source: "owner",
          bookingRequestHold: null,
        },
        {
          id: "booking-hold-block",
          startAt: "2026-06-03T00:00:00.000Z",
          endAt: "2026-06-04T00:00:00.000Z",
          note: "Booking hold",
          source: "booking_hold",
          bookingRequestHold: {
            id: "booking-1",
          },
        },
        {
          id: "legacy-hold-block",
          startAt: "2026-06-05T00:00:00.000Z",
          endAt: "2026-06-06T00:00:00.000Z",
          note: "Legacy hold",
          source: "owner",
          bookingRequestHold: {
            id: "booking-2",
          },
        },
      ],
      location: {
        latitude: 43.6532,
        longitude: -79.3832,
        city: "Toronto",
        region: "Ontario",
        country: "Canada",
        postalCode: "M5H 2N2",
      },
      publishedAt: "2026-05-01T00:00:00.000Z",
      pausedAt: null,
      archivedAt: null,
    };
    const transaction = {
      posting: {
        findUnique: jest.fn(async () => ({
          id: "posting-1",
          photos: [],
        })),
        findUniqueOrThrow: jest.fn(async () => createPostingPersistence()),
        update: jest.fn(async () => createPostingPersistence()),
      },
      postingAvailabilityBlock: {
        deleteMany: jest.fn(async () => ({ count: 1 })),
        createMany: jest.fn(async () => ({ count: 1 })),
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
    } as any);

    await expect(repository.restoreFromSnapshot(snapshot)).resolves.toEqual(
      expect.objectContaining({
        id: "posting-1",
      }),
    );

    expect(
      transaction.postingAvailabilityBlock.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        postingId: "posting-1",
        source: "owner",
      },
    });
    expect(
      transaction.postingAvailabilityBlock.createMany,
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "owner-block",
          source: "owner",
        }),
      ],
    });
  });
  it("lists, finds, updates, and deletes owner availability blocks", async () => {
    const transaction = {
      postingAvailabilityBlock: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({
            count: 1,
          })
          .mockResolvedValueOnce({
            count: 0,
          }),
        findUniqueOrThrow: jest.fn(async () => ({
          id: "block-1",
          startAt: new Date("2026-06-02T00:00:00.000Z"),
          endAt: new Date("2026-06-04T00:00:00.000Z"),
          note: null,
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          updatedAt: new Date("2026-05-20T12:10:00.000Z"),
        })),
        deleteMany: jest
          .fn()
          .mockResolvedValueOnce({
            count: 1,
          })
          .mockResolvedValueOnce({
            count: 0,
          }),
        findMany: jest.fn(async () => [
          {
            id: "block-1",
            startAt: new Date("2026-06-01T00:00:00.000Z"),
            endAt: new Date("2026-06-03T00:00:00.000Z"),
            note: "Owner stay",
            createdAt: new Date("2026-05-20T12:00:00.000Z"),
            updatedAt: new Date("2026-05-20T12:00:00.000Z"),
          },
        ]),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "block-1",
            startAt: new Date("2026-06-01T00:00:00.000Z"),
            endAt: new Date("2026-06-03T00:00:00.000Z"),
            note: "Owner stay",
            createdAt: new Date("2026-05-20T12:00:00.000Z"),
            updatedAt: new Date("2026-05-20T12:00:00.000Z"),
          })
          .mockResolvedValueOnce(null),
      },
      searchReindexRun: {
        findFirst: jest.fn(async () => null),
      },
      postingSearchOutbox: {
        createMany: jest.fn(async () => undefined),
      },
    };
    const repository = new PostingsRepository({
      postingAvailabilityBlock: transaction.postingAvailabilityBlock,
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as any);

    await expect(
      repository.listOwnerAvailabilityBlocks("posting-1"),
    ).resolves.toEqual([
      {
        id: "block-1",
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
        note: "Owner stay",
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z",
      },
    ]);
    await expect(
      repository.findOwnerAvailabilityBlock("posting-1", "block-1"),
    ).resolves.toEqual({
      id: "block-1",
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-03T00:00:00.000Z",
      note: "Owner stay",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });
    await expect(
      repository.findOwnerAvailabilityBlock("posting-1", "missing-block"),
    ).resolves.toBeNull();

    await expect(
      repository.updateOwnerAvailabilityBlock("posting-1", "block-1", {
        startAt: "2026-06-02T00:00:00.000Z",
        endAt: "2026-06-04T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      id: "block-1",
      startAt: "2026-06-02T00:00:00.000Z",
      endAt: "2026-06-04T00:00:00.000Z",
      note: undefined,
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:10:00.000Z",
    });
    await expect(
      repository.updateOwnerAvailabilityBlock("posting-1", "missing-block", {
        startAt: "2026-06-02T00:00:00.000Z",
        endAt: "2026-06-04T00:00:00.000Z",
      }),
    ).resolves.toBeNull();

    await expect(
      repository.deleteOwnerAvailabilityBlock("posting-1", "block-1"),
    ).resolves.toBe(true);
    await expect(
      repository.deleteOwnerAvailabilityBlock("posting-1", "missing-block"),
    ).resolves.toBe(false);
  });

  it("covers posting repository helper branches for photos, ranges, and detail columns", async () => {
    const repository = new PostingsRepository({} as any) as unknown as {
      mergePhotosWithExisting: (
        existingPhotos: Array<{
          blobUrl: string;
          blobName: string;
          thumbnailBlobUrl: string | null;
          thumbnailBlobName: string | null;
        }>,
        nextPhotos: Array<Record<string, unknown>>,
      ) => Array<Record<string, unknown>>;
      collectBlockedRanges: (
        posting: ReturnType<typeof createPostingPersistence>,
      ) => Array<Record<string, string>>;
      extractSearchableAttributes: (
        family: string,
        subtype: string,
        attributes: Record<string, unknown>,
      ) => Record<string, unknown>;
      toPostingDetailsColumns: (
        variant: { family: string; subtype: string },
        details: Record<string, unknown>,
      ) => Record<string, unknown>;
      readPostingDetails: (
        posting: Record<string, unknown>,
      ) => Record<string, unknown>;
      resolveDetailsColumnName: (family?: string) => string;
      orderBatchResult: <TRecord extends { id: string }>(
        ids: string[],
        records: TRecord[],
      ) => { postings: TRecord[]; missingIds: string[] };
      readMysqlLockResult: (
        value: bigint | number | boolean | null | undefined,
      ) => boolean;
      readNumberLike: (value: bigint | number | null | undefined) => number;
    };

    expect(
      repository.mergePhotosWithExisting(
        [
          {
            blobUrl: "https://example.test/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            thumbnailBlobUrl: "https://example.test/photo-1.webp",
            thumbnailBlobName: "postings/thumbnails/photo-1.webp",
          },
          {
            blobUrl: "https://example.test/photo-2.jpg",
            blobName: "postings/photo-2.jpg",
            thumbnailBlobUrl: null,
            thumbnailBlobName: null,
          },
        ],
        [
          {
            blobUrl: "https://example.test/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
          {
            blobUrl: "https://example.test/photo-2.jpg",
            blobName: "postings/photo-2.jpg",
            thumbnailBlobUrl: "https://example.test/photo-2.webp",
            thumbnailBlobName: "postings/thumbnails/photo-2.webp",
            position: 1,
          },
        ],
      ),
    ).toEqual([
      {
        blobUrl: "https://example.test/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        thumbnailBlobUrl: "https://example.test/photo-1.webp",
        thumbnailBlobName: "postings/thumbnails/photo-1.webp",
        position: 0,
      },
      {
        blobUrl: "https://example.test/photo-2.jpg",
        blobName: "postings/photo-2.jpg",
        thumbnailBlobUrl: "https://example.test/photo-2.webp",
        thumbnailBlobName: "postings/thumbnails/photo-2.webp",
        position: 1,
      },
    ]);

    const blockedRanges = repository.collectBlockedRanges(
      createPostingPersistence({
        availabilityBlocks: [
          {
            id: "block-owner",
            postingId: "posting-1",
            startAt: new Date("2026-05-21T00:00:00.000Z"),
            endAt: new Date("2026-05-22T00:00:00.000Z"),
            note: "Owner stay",
            source: "owner",
            bookingRequestHold: null,
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            updatedAt: new Date("2026-05-01T00:00:00.000Z"),
          },
          {
            id: "block-hold",
            postingId: "posting-1",
            startAt: new Date("2026-05-23T00:00:00.000Z"),
            endAt: new Date("2026-05-24T00:00:00.000Z"),
            note: null,
            source: "booking_hold",
            bookingRequestHold: {
              status: "awaiting_payment",
              convertedAt: null,
              holdExpiresAt: new Date("2026-05-25T00:00:00.000Z"),
            },
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            updatedAt: new Date("2026-05-01T00:00:00.000Z"),
          },
        ],
        bookingRequests: [
          {
            id: "booking-valid",
            status: "pending",
            startAt: new Date("2026-05-26T00:00:00.000Z"),
            endAt: new Date("2026-05-27T00:00:00.000Z"),
            holdExpiresAt: new Date("2026-05-28T00:00:00.000Z"),
            convertedAt: null,
            conversionReservationExpiresAt: null,
          },
          {
            id: "booking-converted",
            status: "pending",
            startAt: new Date("2026-05-28T00:00:00.000Z"),
            endAt: new Date("2026-05-29T00:00:00.000Z"),
            holdExpiresAt: new Date("2026-05-30T00:00:00.000Z"),
            convertedAt: new Date("2026-05-28T01:00:00.000Z"),
            conversionReservationExpiresAt: null,
          },
          {
            id: "booking-expired",
            status: "pending",
            startAt: new Date("2026-05-30T00:00:00.000Z"),
            endAt: new Date("2026-05-31T00:00:00.000Z"),
            holdExpiresAt: new Date("2026-05-19T00:00:00.000Z"),
            convertedAt: null,
            conversionReservationExpiresAt: null,
          },
          {
            id: "booking-reserved",
            status: "pending",
            startAt: new Date("2026-06-01T00:00:00.000Z"),
            endAt: new Date("2026-06-02T00:00:00.000Z"),
            holdExpiresAt: new Date("2026-06-03T00:00:00.000Z"),
            convertedAt: null,
            conversionReservationExpiresAt: new Date(
              "2026-06-04T00:00:00.000Z",
            ),
          },
          {
            id: "booking-declined",
            status: "declined",
            startAt: new Date("2026-06-05T00:00:00.000Z"),
            endAt: new Date("2026-06-06T00:00:00.000Z"),
            holdExpiresAt: new Date("2026-06-07T00:00:00.000Z"),
            convertedAt: null,
            conversionReservationExpiresAt: null,
          },
        ],
      }),
    );
    expect(blockedRanges).toEqual([
      expect.objectContaining({
        startAt: "2026-05-21T00:00:00.000Z",
        source: "availability_block",
      }),
      expect.objectContaining({
        startAt: "2026-05-23T00:00:00.000Z",
        source: "availability_block",
      }),
      expect.objectContaining({
        startAt: "2026-05-26T00:00:00.000Z",
        source: "booking_request",
      }),
      expect.objectContaining({
        startAt: "2026-05-26T00:00:00.000Z",
        source: "renting",
      }),
    ]);

    expect(
      repository.extractSearchableAttributes("place", "car", {
        guest_capacity: 2,
      }),
    ).toEqual({});
    expect(
      repository.extractSearchableAttributes("equipment", "camera", {
        brand: "Canon",
        hidden: "ignore",
      }),
    ).toEqual({
      brand: "Canon",
    });

    expect(
      repository.toPostingDetailsColumns(
        {
          family: "equipment",
          subtype: "camera",
        },
        {
          brand: "Canon",
        },
      ),
    ).toMatchObject({
      placeDetails: Prisma.DbNull,
      equipmentDetails: {
        brand: "Canon",
      },
      vehicleDetails: Prisma.DbNull,
    });
    expect(
      repository.toPostingDetailsColumns(
        {
          family: "vehicle",
          subtype: "car",
        },
        {
          make: "Toyota",
        },
      ),
    ).toMatchObject({
      placeDetails: Prisma.DbNull,
      equipmentDetails: Prisma.DbNull,
      vehicleDetails: {
        make: "Toyota",
      },
    });
    expect(
      repository.readPostingDetails(
        createPostingPersistence({
          family: "equipment",
          subtype: "camera",
          placeDetails: null,
          equipmentDetails: {
            brand: "Canon",
            model: "R5",
            condition: "Used",
            power_source: "battery",
            weight_lb: 2.2,
            includes_delivery: true,
          },
        }),
      ),
    ).toMatchObject({
      brand: "Canon",
      model: "R5",
    });
    expect(
      repository.readPostingDetails(
        createPostingPersistence({
          family: "vehicle",
          subtype: "car",
          placeDetails: null,
          vehicleDetails: {
            make: "Toyota",
            model: "Corolla",
            year: 2022,
            seats: 5,
            transmission: "automatic",
            fuel_type: "gasoline",
            license_class: "G",
          },
        }),
      ),
    ).toMatchObject({
      make: "Toyota",
      model: "Corolla",
    });

    expect(repository.resolveDetailsColumnName("equipment")).toBe(
      "equipment_details",
    );
    expect(repository.resolveDetailsColumnName("vehicle")).toBe(
      "vehicle_details",
    );
    expect(repository.resolveDetailsColumnName(undefined)).toBe(
      "place_details",
    );
    expect(
      repository.orderBatchResult(
        ["posting-2", "missing", "posting-1"],
        [
          { id: "posting-1", name: "one" },
          { id: "posting-2", name: "two" },
        ],
      ),
    ).toEqual({
      postings: [
        { id: "posting-2", name: "two" },
        { id: "posting-1", name: "one" },
      ],
      missingIds: ["missing"],
    });
    expect(repository.readMysqlLockResult(1n)).toBe(true);
    expect(repository.readMysqlLockResult(1)).toBe(true);
    expect(repository.readMysqlLockResult(false)).toBe(false);
    expect(repository.readNumberLike(4n)).toBe(4);
    expect(repository.readNumberLike(7)).toBe(7);
    expect(repository.readNumberLike(null)).toBe(0);
  });
});
