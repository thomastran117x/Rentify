import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { ReportsService } from "@/features/reports/reports.service";

function createReportRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-1",
    reporterId: "user-1",
    subjectType: "posting",
    subjectId: "posting-1",
    reasonCode: "spam",
    title: "Looks suspicious",
    description: "This listing asks for payment outside the platform.",
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    reporter: {
      id: "user-1",
      email: "user1@example.com",
      role: "user",
    },
    subjectSnapshot: {
      subjectType: "posting",
      summaryText: "Posting snapshot",
      posting: {
        id: "posting-1",
        name: "Studio Loft",
        status: "published",
        organization: {
          id: "org-1",
          name: "Studio Loft Org",
        },
      },
    },
    ...overrides,
  };
}

function createService(overrides?: {
  repository?: Record<string, unknown>;
  search?: Record<string, unknown>;
  sanitizer?: {
    inspect: (
      input: Array<{ path: string; value: string }>,
    ) => Array<{ path: string; message: string }>;
  };
  organizationAccessService?: {
    findMembership: (
      userId: string,
      organizationId: string,
    ) => Promise<{
      organizationId: string;
      userId: string;
      role: "primary_manager" | "manager" | "operator";
    } | null>;
  };
}) {
  const repository = {
    findPostingSubject: jest.fn(async () => ({
      id: "posting-1",
      name: "Studio Loft",
      status: "published",
      organizationId: "org-1",
      organization: {
        id: "org-1",
        name: "Studio Loft Org",
      },
    })),
    findPostingReviewSubject: jest.fn(async () => ({
      id: "review-1",
      rating: 2,
      title: "Bad stay",
      comment: "Felt unsafe.",
      reviewerId: "user-2",
      reviewer: {
        id: "user-2",
        email: "user2@example.com",
        role: "user",
        profile: {
          username: "renter-two",
          avatarUrl: null,
        },
      },
      posting: {
        id: "posting-1",
        name: "Studio Loft",
      },
    })),
    findUserSubject: jest.fn(async () => ({
      id: "user-2",
      email: "user2@example.com",
      role: "user",
      profile: {
        username: "renter-two",
        avatarUrl: null,
      },
    })),
    createReport: jest.fn(async () => createReportRecord()),
    listReportsDb: jest.fn(async () => ({
      reports: [createReportRecord()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    findReportsByIds: jest.fn(async () => [createReportRecord()]),
    findById: jest.fn(async () => ({
      ...createReportRecord(),
      events: [],
    })),
    findReportRecordById: jest.fn(async () => createReportRecord()),
    updateAssignment: jest.fn(async () => createReportRecord()),
    updateStatus: jest.fn(async () =>
      createReportRecord({
        status: "resolved",
      }),
    ),
    findUserSummaryById: jest.fn(async (userId: string) => ({
      id: userId,
      email: `${userId}@example.com`,
      role: userId === "moderator-1" ? "moderator" : "user",
    })),
    claimSearchOutboxBatch: jest.fn(async () => []),
    listReportsForIndexing: jest.fn(async () => []),
    markSearchOutboxProcessed: jest.fn(async () => undefined),
    retrySearchOutbox: jest.fn(async () => undefined),
    markSearchOutboxDeadLettered: jest.fn(async () => undefined),
    ...overrides?.repository,
  };

  const search = {
    isElasticsearchEnabled: jest.fn(() => true),
    search: jest.fn(async () => ({
      ids: ["report-1"],
      total: 1,
    })),
    upsertDocument: jest.fn(async () => undefined),
    deleteDocument: jest.fn(async () => undefined),
    ...overrides?.search,
  };

  const sanitizer = overrides?.sanitizer ?? {
    inspect: () => [],
  };
  const organizationAccessService = overrides?.organizationAccessService ?? {
    findMembership: jest.fn(async () => null),
  };

  return {
    service: new ReportsService(
      repository as never,
      search as never,
      sanitizer as never,
      organizationAccessService as unknown as OrganizationAccessService,
    ),
    repository,
    search,
    organizationAccessService,
  };
}

describe("ReportsService", () => {
  it("rejects self-reporting for owned postings", async () => {
    const { service } = createService({
      organizationAccessService: {
        findMembership: jest.fn(async (userId: string, organizationId: string) =>
          userId === "user-1" && organizationId === "org-1"
            ? {
                organizationId,
                userId,
                role: "primary_manager",
              }
            : null,
        ),
      },
    });

    await expect(
      service.create({
        reporterId: "user-1",
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "Bad listing",
        description: "This is an invalid self-report attempt.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("falls back to database-backed moderation search when elasticsearch fails", async () => {
    const { service, repository } = createService({
      search: {
        search: jest.fn(async () => {
          throw new Error("search unavailable");
        }),
      },
    });

    const result = await service.listModeration({
      page: 1,
      pageSize: 20,
      sort: "newest",
    });

    expect(result.source).toBe("database");
    expect(repository.listReportsDb).toHaveBeenCalled();
  });

  it("prevents non-admin moderators from assigning another moderator", async () => {
    const { service } = createService();

    await expect(
      service.assign({
        actorUserId: "moderator-1",
        actorRole: "moderator",
        reportId: "report-1",
        assignedModeratorId: "moderator-2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects invalid status transitions", async () => {
    const { service } = createService({
      repository: {
        findReportRecordById: jest.fn(async () =>
          createReportRecord({
            status: "dismissed",
          }),
        ),
      },
    });

    await expect(
      service.updateStatus({
        actorUserId: "moderator-1",
        actorRole: "moderator",
        reportId: "report-1",
        status: "resolved",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
