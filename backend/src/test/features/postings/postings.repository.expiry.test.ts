import { PostingsRepository } from "@/features/postings/postings.repository";

const EXISTING = new Date("2026-09-01T23:59:59.999Z");

function createPostingPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
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
    minBookingDurationDays: null,
    advanceNoticeDays: null,
    cancellationPolicy: null,
    cancellationPolicyNotes: null,
    instantBooking: false,
    averageRating: null,
    reviewCount: 0,
    latitude: 43.6532,
    longitude: -79.3832,
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "M5H 2N2",
    photos: [],
    availabilityBlocks: [],
    bookingRequests: [],
    rentings: [],
    organization: null,
    publishedAt: null,
    pausedAt: null,
    archivedAt: null,
    expiresAt: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
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
    tags: ["loft"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    availabilityNotes: null,
    availabilityBlocks: [],
    location: {
      latitude: 43.6532,
      longitude: -79.3832,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5H 2N2",
    },
    ...overrides,
  } as never;
}

function createUpdateHarness(currentExpiresAt: Date | null) {
  const transaction = {
    posting: {
      findUnique: jest.fn(async () => ({
        photos: [],
        expiresAt: currentExpiresAt,
      })),
      update: jest.fn(async (_args: { data: Record<string, unknown> }) =>
        createPostingPersistence(),
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
  } as never);

  return { repository, transaction };
}

function readUpdateData(transaction: {
  posting: {
    update: { mock: { calls: Array<[{ data: Record<string, unknown> }]> } };
  };
}): Record<string, unknown> {
  return transaction.posting.update.mock.calls[0][0].data;
}

describe("PostingsRepository expiry columns", () => {
  it("re-arms the reminder when an expiry date is first set", async () => {
    const { repository, transaction } = createUpdateHarness(null);

    await repository.update(
      "posting-1",
      createUpsertPostingInput({ expiresAt: EXISTING.toISOString() }),
    );

    const data = readUpdateData(transaction);
    expect(data.expiresAt).toEqual(EXISTING);
    expect(data.expiryReminderSentAt).toBeNull();
  });

  it("re-arms the reminder when an expiry date is moved", async () => {
    const { repository, transaction } = createUpdateHarness(EXISTING);
    const moved = "2026-10-15T23:59:59.999Z";

    await repository.update(
      "posting-1",
      createUpsertPostingInput({ expiresAt: moved }),
    );

    const data = readUpdateData(transaction);
    expect(data.expiresAt).toEqual(new Date(moved));
    expect(data.expiryReminderSentAt).toBeNull();
  });

  it("re-arms the reminder when an expiry date is cleared", async () => {
    const { repository, transaction } = createUpdateHarness(EXISTING);

    await repository.update(
      "posting-1",
      createUpsertPostingInput({ expiresAt: null }),
    );

    const data = readUpdateData(transaction);
    expect(data.expiresAt).toBeNull();
    expect(data.expiryReminderSentAt).toBeNull();
  });

  it("leaves the reminder latch alone when the expiry date is unchanged", async () => {
    const { repository, transaction } = createUpdateHarness(EXISTING);

    await repository.update(
      "posting-1",
      createUpsertPostingInput({ expiresAt: EXISTING.toISOString() }),
    );

    const data = readUpdateData(transaction);
    expect(data.expiresAt).toEqual(EXISTING);
    // An unrelated edit must not re-send a reminder that already went out.
    expect(data).not.toHaveProperty("expiryReminderSentAt");
  });

  it("stores the expiry date on create", async () => {
    const transaction = {
      posting: {
        create: jest.fn(async (_args: { data: Record<string, unknown> }) =>
          createPostingPersistence(),
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
    } as never);

    await repository.create(
      createUpsertPostingInput({ expiresAt: EXISTING.toISOString() }),
    );

    expect(transaction.posting.create.mock.calls[0][0].data.expiresAt).toEqual(
      EXISTING,
    );
  });
});

describe("PostingsRepository expiry sweeps", () => {
  it("selects only published postings that are past their expiry date", async () => {
    const findMany = jest.fn(async (_args: Record<string, unknown>) => [
      {
        id: "posting-1",
        organizationId: "org-1",
        name: "Sunny loft",
        expiresAt: EXISTING,
      },
    ]);
    const repository = new PostingsRepository({
      posting: { findMany },
    } as never);

    const candidates = await repository.listPostingsDueForExpiry(25);

    expect(candidates).toEqual([
      {
        id: "posting-1",
        organizationId: "org-1",
        name: "Sunny loft",
        expiresAt: EXISTING.toISOString(),
      },
    ]);
    const args = findMany.mock.calls[0][0] as {
      where: { status: string; expiresAt: { lte: Date } };
      take: number;
    };
    expect(args.where.status).toBe("published");
    expect(args.where.expiresAt.lte).toBeInstanceOf(Date);
    expect(args.take).toBe(25);
  });

  it("selects only unreminded postings inside the lead window", async () => {
    const findMany = jest.fn(async (_args: Record<string, unknown>) => []);
    const repository = new PostingsRepository({
      posting: { findMany },
    } as never);
    const windowEndsAt = new Date("2026-09-05T00:00:00.000Z");

    await repository.listPostingsDueForExpiryReminder(10, windowEndsAt);

    const args = findMany.mock.calls[0][0] as {
      where: {
        status: string;
        expiryReminderSentAt: null;
        expiresAt: { gt: Date; lte: Date };
      };
    };
    expect(args.where.status).toBe("published");
    expect(args.where.expiryReminderSentAt).toBeNull();
    expect(args.where.expiresAt.lte).toBe(windowEndsAt);
    expect(args.where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("pauses a due posting and enqueues a search delete", async () => {
    const transaction = {
      posting: {
        updateMany: jest.fn(async (_args: Record<string, unknown>) => ({
          count: 1,
        })),
        findUnique: jest.fn(async () =>
          createPostingPersistence({ status: "paused" }),
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
    } as never);

    const result = await repository.expireIfDue("posting-1");

    expect(result?.status).toBe("paused");
    const args = transaction.posting.updateMany.mock.calls[0][0] as {
      where: { id: string; status: string; expiresAt: { lte: Date } };
      data: Record<string, unknown>;
    };
    // The status/expiry predicate is the compare-and-swap that stops a
    // concurrently archived posting from being resurrected.
    expect(args.where).toMatchObject({ id: "posting-1", status: "published" });
    expect(args.where.expiresAt.lte).toBeInstanceOf(Date);
    expect(args.data).toMatchObject({ status: "paused", archivedAt: null });
    expect(transaction.postingSearchOutbox.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            postingId: "posting-1",
            operation: "delete",
          }),
        ],
      }),
    );
  });

  it("returns null and touches nothing when the posting is no longer due", async () => {
    const transaction = {
      posting: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findUnique: jest.fn(),
      },
      postingSearchOutbox: {
        createMany: jest.fn(),
      },
    };
    const repository = new PostingsRepository({
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as never);

    await expect(repository.expireIfDue("posting-1")).resolves.toBeNull();
    expect(transaction.posting.findUnique).not.toHaveBeenCalled();
    expect(transaction.postingSearchOutbox.createMany).not.toHaveBeenCalled();
  });

  it("claims the reminder latch exactly once", async () => {
    const updateMany = jest.fn(async (_args: Record<string, unknown>) => ({
      count: 1,
    }));
    const repository = new PostingsRepository({
      posting: { updateMany },
    } as never);

    await expect(repository.markExpiryReminderSent("posting-1")).resolves.toBe(
      true,
    );
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "posting-1", expiryReminderSentAt: null },
    });
  });

  it("reports a lost race for the reminder latch", async () => {
    const repository = new PostingsRepository({
      posting: { updateMany: jest.fn(async () => ({ count: 0 })) },
    } as never);

    await expect(repository.markExpiryReminderSent("posting-1")).resolves.toBe(
      false,
    );
  });

  it("maps the expiry date onto the posting record", async () => {
    const repository = new PostingsRepository({
      posting: {
        findUnique: jest.fn(async () =>
          createPostingPersistence({ expiresAt: EXISTING }),
        ),
      },
    } as never);

    const posting = await repository.findById("posting-1");

    expect(posting?.expiresAt).toBe(EXISTING.toISOString());
  });
});
