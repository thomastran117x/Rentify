import { Prisma } from "@prisma/client";
import { ReportsRepository } from "@/features/reports/reports.repository";

function createUserPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    role: "moderator",
    profile: {
      username: "moderator-one",
      avatarUrl: "https://example.test/avatar.png",
    },
    ...overrides,
  };
}

function createReportPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    reporterId: "user-1",
    subjectType: "posting",
    subjectId: "posting-1",
    reasonCode: "spam",
    title: "Looks suspicious",
    description: "This listing asks for payment outside the platform.",
    status: "open",
    resolutionCode: null,
    resolutionSummary: null,
    reviewedAt: null,
    subjectSnapshotText: "Posting snapshot",
    subjectSnapshot: {
      subjectType: "posting",
      summaryText: "Posting snapshot",
    },
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    reporter: createUserPersistence({
      role: "user",
      profile: {
        username: "reporter-one",
        avatarUrl: null,
      },
    }),
    assignedModerator: createUserPersistence(),
    ...overrides,
  };
}

function createEventPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    eventType: "status_changed",
    fromStatus: "open",
    toStatus: "under_review",
    assignmentUserId: null,
    note: "Escalated.",
    createdAt: new Date("2026-05-03T00:00:00.000Z"),
    actor: createUserPersistence(),
    ...overrides,
  };
}

function createOutboxPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    reportId: "report-1",
    operation: "upsert",
    attempts: 0,
    availableAt: new Date("2026-05-04T00:00:00.000Z"),
    processingAt: null,
    processedAt: null,
    deadLetteredAt: null,
    lastError: null,
    createdAt: new Date("2026-05-04T00:00:00.000Z"),
    updatedAt: new Date("2026-05-04T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ReportsRepository", () => {
  it("creates reports, audit events, and search outbox records in one transaction", async () => {
    const createReport = jest.fn(async () => createReportPersistence());
    const createEvent = jest.fn(async () => undefined);
    const createOutbox = jest.fn(async () => undefined);
    const database = {
      $transaction: async <T>(
        callback: (transaction: {
          contentReport: { create: typeof createReport };
          contentReportEvent: { create: typeof createEvent };
          contentReportSearchOutbox: { create: typeof createOutbox };
        }) => Promise<T>,
      ) =>
        callback({
          contentReport: { create: createReport },
          contentReportEvent: { create: createEvent },
          contentReportSearchOutbox: { create: createOutbox },
        }),
    };
    const repository = new ReportsRepository(database as never);

    const result = await repository.createReport(
      {
        reporterId: "user-1",
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "Looks suspicious",
        description: "This listing asks for payment outside the platform.",
      },
      {
        subjectType: "posting",
        summaryText: "Posting snapshot",
        posting: {
          id: "posting-1",
          name: "Studio Loft",
          status: "published",
          organization: {
            id: "org-1",
            name: "Northwind",
          },
        },
      },
    );

    expect(createReport).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        reporterId: "user-1",
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "Looks suspicious",
        description: "This listing asks for payment outside the platform.",
        subjectSnapshotText: "Posting snapshot",
      }),
      include: expect.any(Object),
    });
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        reportId: "report-1",
        actorUserId: "user-1",
        eventType: "created",
      }),
    });
    expect(createOutbox).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        reportId: "report-1",
        operation: "upsert",
      }),
    });
    expect(result.reporter.username).toBe("reporter-one");
  });

  it("lists reports with filters, sorting, and pagination", async () => {
    const findMany = jest.fn(async () => [createReportPersistence()]);
    const count = jest.fn(async () => 3);
    const repository = new ReportsRepository({
      contentReport: {
        findMany,
        count,
      },
    } as never);

    const result = await repository.listReportsDb({
      page: 2,
      pageSize: 2,
      query: "spam",
      status: "open",
      subjectType: "posting",
      reasonCode: "spam",
      assignedTo: "unassigned",
      reporterId: "user-1",
      sort: "recentlyReviewed",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "open",
        subjectType: "posting",
        reasonCode: "spam",
        assignedModeratorId: null,
        reporterId: "user-1",
        OR: [
          {
            title: {
              contains: "spam",
            },
          },
          {
            description: {
              contains: "spam",
            },
          },
          {
            subjectSnapshotText: {
              contains: "spam",
            },
          },
        ],
      },
      skip: 2,
      take: 2,
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }],
      include: expect.any(Object),
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(result.query).toBe("spam");
  });

  it("maps report detail events and search documents", async () => {
    const findUnique = jest
      .fn(async () => ({
        ...createReportPersistence(),
        events: [createEventPersistence()],
      }))
      .mockResolvedValueOnce({
        ...createReportPersistence(),
        events: [createEventPersistence()],
      })
      .mockResolvedValueOnce(createReportPersistence());
    const findMany = jest.fn(async () => [createReportPersistence()]);
    const repository = new ReportsRepository({
      contentReport: {
        findUnique,
        findMany,
      },
    } as never);

    const detail = await repository.findById("report-1");
    const indexDocs = await repository.listReportsForIndexing(["report-1"]);

    expect(detail?.events).toEqual([
      {
        id: "event-1",
        eventType: "status_changed",
        fromStatus: "open",
        toStatus: "under_review",
        assignmentUserId: undefined,
        note: "Escalated.",
        actor: {
          id: "user-1",
          email: "user@example.com",
          username: "moderator-one",
          avatarUrl: "https://example.test/avatar.png",
          role: "moderator",
        },
        createdAt: "2026-05-03T00:00:00.000Z",
      },
    ]);
    expect(indexDocs).toEqual([
      {
        id: "report-1",
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        status: "open",
        title: "Looks suspicious",
        description: "This listing asks for payment outside the platform.",
        subjectSnapshotText: "Posting snapshot",
        reporterId: "user-1",
        reporterEmail: "user@example.com",
        reporterUsername: "reporter-one",
        reporterRole: "user",
        assignedModeratorId: "user-1",
        assignedModeratorEmail: "user@example.com",
        assignedModeratorUsername: "moderator-one",
        assignedModeratorRole: "moderator",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        reviewedAt: undefined,
      },
    ]);
  });

  it("returns null for missing assignment and status updates", async () => {
    const missingError = new Prisma.PrismaClientKnownRequestError("missing", {
      code: "P2025",
      clientVersion: "test",
    });
    const database = {
      $transaction: jest.fn(async () => {
        throw missingError;
      }),
    };
    const repository = new ReportsRepository(database as never);

    await expect(
      repository.updateAssignment({
        reportId: "missing",
        actorUserId: "user-1",
        assignedModeratorId: "moderator-1",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.updateStatus({
        reportId: "missing",
        actorUserId: "user-1",
        status: "resolved",
      }),
    ).resolves.toBeNull();
  });

  it("claims outbox batches, marks them processing, and maps timestamps", async () => {
    const findMany = jest.fn(async () => [createOutboxPersistence()]);
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const repository = new ReportsRepository({
      contentReportSearchOutbox: {
        findMany,
        updateMany,
      },
    } as never);

    const result = await repository.claimSearchOutboxBatch(10);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        processedAt: null,
        deadLetteredAt: null,
        availableAt: {
          lte: expect.any(Date),
        },
        processingAt: null,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 10,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["outbox-1"],
        },
      },
      data: {
        processingAt: expect.any(Date),
      },
    });
    expect(result[0]).toMatchObject({
      id: "outbox-1",
      reportId: "report-1",
      operation: "upsert",
      attempts: 0,
      availableAt: "2026-05-04T00:00:00.000Z",
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
    });
  });
});
