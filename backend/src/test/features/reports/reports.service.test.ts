import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { ReportsService } from "@/features/reports/reports.service";
import { testUuid } from "../../support/uuid";
const ADMIN_1_ID = testUuid(9000, 185107);
const MISSING_ID = testUuid(9000, 394917);

const MODERATOR_1_ID = testUuid(9000, 903590);
const MODERATOR_2_ID = testUuid(9000, 903591);
const REPORT_1_ID = testUuid(9000, 265803);
const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);
const USER_9_ID = testUuid(9000, 994265);

function createReportRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_1_ID,
    reporterId: USER_1_ID,
    subjectType: "posting",
    subjectId: "posting-1",
    reasonCode: "spam",
    title: "Looks suspicious",
    description: "This listing asks for payment outside the platform.",
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    reporter: {
      id: USER_1_ID,
      email: `${USER_1_ID}@example.com`,
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

function createOutboxEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    reportId: REPORT_1_ID,
    operation: "upsert",
    attempts: 0,
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
      reviewerId: USER_2_ID,
      reviewer: {
        id: USER_2_ID,
        email: `${USER_2_ID}@example.com`,
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
    findOrganizationBlogCommentSubject: jest.fn(async () => ({
      id: "blog-comment-1",
      body: "Buy cheap followers at example.test",
      authorUserId: USER_2_ID,
      deletedAt: null,
      author: {
        id: USER_2_ID,
        email: `${USER_2_ID}@example.com`,
        role: "user",
        profile: {
          username: "renter-two",
          avatarUrl: null,
        },
      },
      post: {
        id: "blog-1",
        title: "Introducing weekend stays",
        slug: "introducing-weekend-stays",
        organization: {
          id: "org-1",
          name: "Studio Loft Org",
        },
      },
    })),
    findUserSubject: jest.fn(async () => ({
      id: USER_2_ID,
      email: `${USER_2_ID}@example.com`,
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
      role: userId === MODERATOR_1_ID ? "moderator" : "admin",
    })),
    claimSearchOutboxBatch: jest.fn(async () => []),
    listReportsForIndexing: jest.fn(async () => [createReportRecord()]),
    markSearchOutboxProcessed: jest.fn(async () => undefined),
    retrySearchOutbox: jest.fn(async () => undefined),
    markSearchOutboxDeadLettered: jest.fn(async () => undefined),
    ...overrides?.repository,
  };

  const search = {
    isElasticsearchEnabled: jest.fn(() => true),
    search: jest.fn(async () => ({
      ids: [REPORT_1_ID],
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
      repository as any,
      search as any,
      sanitizer as any,
      organizationAccessService as unknown as OrganizationAccessService,
    ),
    repository,
    search,
    organizationAccessService,
  };
}

describe("ReportsService", () => {
  it("creates posting reports with a resolved posting snapshot", async () => {
    const { service, repository } = createService();

    await service.create({
      reporterId: USER_1_ID,
      subjectType: "posting",
      subjectId: "posting-1",
      reasonCode: "spam",
      title: "Bad listing",
      description: "This listing tries to move payment off-platform.",
    });

    expect(repository.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: USER_1_ID,
        subjectType: "posting",
      }),
      {
        subjectType: "posting",
        summaryText: "Studio Loft published Studio Loft Org",
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
    );
  });

  it("rejects unsafe report title or description content", async () => {
    const { service, repository } = createService({
      sanitizer: {
        inspect: () => [
          {
            path: "title",
            message: "Contains blocked phrase.",
          },
        ],
      },
    });

    await expect(
      service.create({
        reporterId: USER_1_ID,
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "Scam listing",
        description: "This listing tries to move payment off-platform.",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.createReport).not.toHaveBeenCalled();
  });

  it("rejects self-reporting for owned postings", async () => {
    const { service } = createService({
      organizationAccessService: {
        findMembership: jest.fn(
          async (userId: string, organizationId: string) =>
            userId === USER_1_ID && organizationId === "org-1"
              ? {
                  organizationId,
                  userId,
                  role: "primary_manager" as const,
                }
              : null,
        ),
      },
    });

    await expect(
      service.create({
        reporterId: USER_1_ID,
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "Bad listing",
        description: "This is an invalid self-report attempt.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates posting review reports with reviewer and excerpt details", async () => {
    const { service, repository } = createService();

    await service.create({
      reporterId: USER_9_ID,
      subjectType: "posting_review",
      subjectId: "review-1",
      reasonCode: "review_manipulation",
      title: "Suspicious review",
      description: "This review looks coordinated and misleading.",
    });

    expect(repository.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "posting_review",
      }),
      expect.objectContaining({
        subjectType: "posting_review",
        review: expect.objectContaining({
          id: "review-1",
          rating: 2,
          commentExcerpt: "Felt unsafe.",
          reviewer: expect.objectContaining({
            id: USER_2_ID,
            username: "renter-two",
            role: "user",
          }),
        }),
      }),
    );
  });

  it("creates blog comment reports with post and author details", async () => {
    const { service, repository } = createService();

    await service.create({
      reporterId: USER_9_ID,
      subjectType: "organization_blog_comment",
      subjectId: "blog-comment-1",
      reasonCode: "spam",
      title: "Spam comment",
      description: "This comment is advertising a follower-selling service.",
    });

    expect(repository.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "organization_blog_comment",
      }),
      expect.objectContaining({
        subjectType: "organization_blog_comment",
        comment: expect.objectContaining({
          id: "blog-comment-1",
          bodyExcerpt: "Buy cheap followers at example.test",
          author: expect.objectContaining({
            id: USER_2_ID,
            username: "renter-two",
          }),
          post: expect.objectContaining({
            id: "blog-1",
            slug: "introducing-weekend-stays",
          }),
        }),
      }),
    );
  });

  it("rejects reporting your own comment", async () => {
    const { service } = createService();

    await expect(
      service.create({
        reporterId: USER_2_ID,
        subjectType: "organization_blog_comment",
        subjectId: "blog-comment-1",
        reasonCode: "spam",
        title: "Spam comment",
        description: "This is an invalid self-report attempt.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects reporting a comment that is already a tombstone", async () => {
    const { service } = createService({
      repository: {
        findOrganizationBlogCommentSubject: jest.fn(async () => ({
          id: "blog-comment-1",
          body: "",
          authorUserId: USER_2_ID,
          deletedAt: new Date("2026-07-17T00:00:00.000Z"),
          author: {
            id: USER_2_ID,
            email: `${USER_2_ID}@example.com`,
            role: "user",
            profile: { username: "renter-two", avatarUrl: null },
          },
          post: {
            id: "blog-1",
            title: "Introducing weekend stays",
            slug: "introducing-weekend-stays",
            organization: { id: "org-1", name: "Studio Loft Org" },
          },
        })),
      },
    });

    // The text the reporter objected to is already gone, so there is nothing
    // for a moderator to act on.
    await expect(
      service.create({
        reporterId: USER_9_ID,
        subjectType: "organization_blog_comment",
        subjectId: "blog-comment-1",
        reasonCode: "spam",
        title: "Spam comment",
        description: "This comment is advertising a follower-selling service.",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects reporting a comment that does not exist", async () => {
    const { service } = createService({
      repository: {
        findOrganizationBlogCommentSubject: jest.fn(async () => null),
      },
    });

    await expect(
      service.create({
        reporterId: USER_9_ID,
        subjectType: "organization_blog_comment",
        subjectId: MISSING_ID,
        reasonCode: "spam",
        title: "Spam comment",
        description: "This comment is advertising a follower-selling service.",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects reporting your own review", async () => {
    const { service } = createService({
      repository: {
        findPostingReviewSubject: jest.fn(async () => ({
          id: "review-1",
          rating: 5,
          title: "Great stay",
          comment: "Loved it.",
          reviewerId: USER_1_ID,
          reviewer: {
            id: USER_1_ID,
            email: `${USER_1_ID}@example.com`,
            role: "user",
            profile: {
              username: "self-reviewer",
              avatarUrl: null,
            },
          },
          posting: {
            id: "posting-1",
            name: "Studio Loft",
          },
        })),
      },
    });

    await expect(
      service.create({
        reporterId: USER_1_ID,
        subjectType: "posting_review",
        subjectId: "review-1",
        reasonCode: "other",
        title: "My own review",
        description: "This should fail because the review belongs to me.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates user reports with normalized user summaries", async () => {
    const { service, repository } = createService({
      repository: {
        findUserSubject: jest.fn(async () => ({
          id: USER_2_ID,
          email: `${USER_2_ID}@example.com`,
          role: "owner",
          profile: {
            username: "renter-two",
            avatarUrl: "https://example.test/avatar.png",
          },
        })),
      },
    });

    await service.create({
      reporterId: USER_1_ID,
      subjectType: "user",
      subjectId: USER_2_ID,
      reasonCode: "harassment_or_hate",
      title: "Abusive messages",
      description:
        "This user is sending abusive messages through the platform.",
    });

    expect(repository.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "user",
      }),
      {
        subjectType: "user",
        summaryText: "renter-two owner",
        user: {
          id: USER_2_ID,
          email: `${USER_2_ID}@example.com`,
          role: "owner",
          username: "renter-two",
          avatarUrl: "https://example.test/avatar.png",
        },
      },
    );
  });

  it("falls back to database moderation search when elasticsearch is disabled", async () => {
    const { service, repository } = createService({
      search: {
        isElasticsearchEnabled: jest.fn(() => false),
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

  it("uses elasticsearch results when moderation search succeeds", async () => {
    const { service, repository, search } = createService({
      search: {
        search: jest.fn(async () => ({
          ids: ["report-2", REPORT_1_ID],
          total: 8,
        })),
      },
      repository: {
        findReportsByIds: jest.fn(async () => [
          createReportRecord({ id: "report-2" }),
          createReportRecord({ id: REPORT_1_ID }),
        ]),
      },
    });

    const result = await service.listModeration({
      page: 2,
      pageSize: 5,
      sort: "newest",
      query: "fraud",
    });

    expect(search.search).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      sort: "newest",
      query: "fraud",
    });
    expect(repository.findReportsByIds).toHaveBeenCalledWith([
      "report-2",
      REPORT_1_ID,
    ]);
    expect(result).toMatchObject({
      source: "elasticsearch",
      query: "fraud",
      pagination: {
        page: 2,
        pageSize: 5,
        total: 8,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
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

  it("throws when moderation detail is missing", async () => {
    const { service } = createService({
      repository: {
        findById: jest.fn(async () => null),
      },
    });

    await expect(
      service.getModerationDetail(MISSING_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("defaults undefined report assignment to the acting moderator", async () => {
    const { service, repository } = createService();

    await service.assign({
      actorUserId: MODERATOR_1_ID,
      actorRole: "moderator",
      reportId: REPORT_1_ID,
    });

    expect(repository.updateAssignment).toHaveBeenCalledWith({
      reportId: REPORT_1_ID,
      actorUserId: MODERATOR_1_ID,
      assignedModeratorId: MODERATOR_1_ID,
    });
  });

  it("prevents non-admin moderators from assigning another moderator", async () => {
    const { service } = createService();

    await expect(
      service.assign({
        actorUserId: MODERATOR_1_ID,
        actorRole: "moderator",
        reportId: REPORT_1_ID,
        assignedModeratorId: MODERATOR_2_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects assignments to non-moderator roles", async () => {
    const { service } = createService({
      repository: {
        findUserSummaryById: jest.fn(async () => ({
          id: USER_2_ID,
          email: `${USER_2_ID}@example.com`,
          role: "user",
        })),
      },
    });

    await expect(
      service.assign({
        actorUserId: ADMIN_1_ID,
        actorRole: "admin",
        reportId: REPORT_1_ID,
        assignedModeratorId: USER_2_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects missing assignees", async () => {
    const { service } = createService({
      repository: {
        findUserSummaryById: jest.fn(async () => null),
      },
    });

    await expect(
      service.assign({
        actorUserId: ADMIN_1_ID,
        actorRole: "admin",
        reportId: REPORT_1_ID,
        assignedModeratorId: MISSING_ID,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
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
        actorUserId: MODERATOR_1_ID,
        actorRole: "moderator",
        reportId: REPORT_1_ID,
        status: "resolved",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("trims moderation status updates before persistence", async () => {
    const { service, repository } = createService();

    await service.updateStatus({
      actorUserId: MODERATOR_1_ID,
      actorRole: "moderator",
      reportId: REPORT_1_ID,
      status: "resolved",
      resolutionCode: "action_taken",
      resolutionSummary: "  Listing removed  ",
      note: "  Escalated to trust and safety  ",
    });

    expect(repository.updateStatus).toHaveBeenCalledWith({
      reportId: REPORT_1_ID,
      actorUserId: MODERATOR_1_ID,
      status: "resolved",
      resolutionCode: "action_taken",
      resolutionSummary: "Listing removed",
      note: "Escalated to trust and safety",
    });
  });

  it("rejects unsafe optional moderation text", async () => {
    const { service, repository } = createService({
      sanitizer: {
        inspect: () => [
          {
            path: "note",
            message: "Contains blocked phrase.",
          },
        ],
      },
    });

    await expect(
      service.updateStatus({
        actorUserId: MODERATOR_1_ID,
        actorRole: "moderator",
        reportId: REPORT_1_ID,
        status: "resolved",
        resolutionCode: "action_taken",
        note: "bad text",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it("returns zero when no search outbox entries are available", async () => {
    const { service, repository } = createService();

    const result = await service.processSearchOutboxBatch(10);

    expect(result).toBe(0);
    expect(repository.markSearchOutboxProcessed).not.toHaveBeenCalled();
  });

  it("indexes upserts, deletes missing reports, and marks processed ids", async () => {
    const { service, repository, search } = createService({
      repository: {
        claimSearchOutboxBatch: jest.fn(async () => [
          createOutboxEntry({
            id: "outbox-1",
            reportId: REPORT_1_ID,
            operation: "upsert",
          }),
          createOutboxEntry({
            id: "outbox-2",
            reportId: "report-2",
            operation: "delete",
          }),
          createOutboxEntry({
            id: "outbox-3",
            reportId: "report-3",
            operation: "upsert",
          }),
        ]),
        listReportsForIndexing: jest.fn(async () => [
          createReportRecord({ id: REPORT_1_ID }),
        ]),
      },
    });

    const result = await service.processSearchOutboxBatch(3);

    expect(result).toBe(3);
    expect(search.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REPORT_1_ID,
      }),
    );
    expect(search.deleteDocument).toHaveBeenCalledWith("report-2");
    expect(search.deleteDocument).toHaveBeenCalledWith("report-3");
    expect(repository.markSearchOutboxProcessed).toHaveBeenCalledWith([
      "outbox-1",
      "outbox-2",
      "outbox-3",
    ]);
  });

  it("retries transient outbox failures and dead-letters exhausted ones", async () => {
    const deleteDocument = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("permanent failure"));
    const { service, repository } = createService({
      repository: {
        claimSearchOutboxBatch: jest.fn(async () => [
          createOutboxEntry({
            id: "outbox-1",
            reportId: REPORT_1_ID,
            operation: "delete",
            attempts: 1,
          }),
          createOutboxEntry({
            id: "outbox-2",
            reportId: "report-2",
            operation: "delete",
            attempts: 4,
          }),
        ]),
      },
      search: {
        deleteDocument,
      },
    });

    const result = await service.processSearchOutboxBatch(2);

    expect(result).toBe(2);
    expect(repository.retrySearchOutbox).toHaveBeenCalledWith(
      "outbox-1",
      2,
      "temporary failure",
    );
    expect(repository.markSearchOutboxDeadLettered).toHaveBeenCalledWith(
      "outbox-2",
      5,
      "permanent failure",
    );
    expect(repository.markSearchOutboxProcessed).toHaveBeenCalledWith([]);
  });
});
