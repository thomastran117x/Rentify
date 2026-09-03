import { createHash } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { PostingsAnalyticsService } from "@/features/postings/analytics/analytics.service";
import { testUuid } from "../../support/uuid";
const DEVICE_1_ID = testUuid(9200, 895443);
const ORG_1_ID = testUuid(9200, 9234);
const ORG_2_ID = testUuid(9200, 9235);

const OWNER_1_ID = testUuid(9000, 219201);
const POSTING_1_ID = testUuid(9000, 254272);
const POSTING_2_ID = testUuid(9000, 254273);

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPublicPosting(overrides: Record<string, unknown> = {}): any {
  return {
    id: POSTING_1_ID,
    organizationId: ORG_1_ID,
    status: "published",
    archivedAt: undefined,
    ...overrides,
  };
}

function createClient(
  overrides?: Partial<{
    ip: string;
    device: {
      id?: string;
      type: "unknown" | "mobile" | "tablet" | "desktop" | "bot";
      isMobile: boolean;
      userAgent?: string;
      platform?: string;
    };
  }>,
): any {
  return {
    ip: "203.0.113.10",
    device: {
      id: DEVICE_1_ID,
      type: "desktop",
      isMobile: false,
      userAgent: "Mozilla/5.0",
      platform: "macOS",
      ...overrides?.device,
    },
    ...overrides,
  };
}

describe("PostingsAnalyticsService", () => {
  function createOrganizationAccessService() {
    return {
      requireActiveMembership: jest.fn(async (userId: string) => ({
        organizationId: ORG_1_ID,
        userId,
        role: "primary_manager",
      })),
      requireMembership: jest.fn(
        async (userId: string, organizationId: string) => {
          if (userId === OWNER_1_ID && organizationId === ORG_1_ID) {
            return {
              organizationId,
              userId,
              role: "primary_manager",
            };
          }

          throw new ForbiddenError(
            "You do not have access to this posting analytics.",
          );
        },
      ),
      findMembership: jest.fn(async (userId: string, organizationId: string) =>
        userId === OWNER_1_ID && organizationId === ORG_1_ID
          ? {
              organizationId,
              userId,
              role: "primary_manager",
            }
          : null,
      ),
      assertCanManage: jest.fn(),
    } as unknown as OrganizationAccessService;
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T14:30:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("tracks public views for eligible viewers with hashed viewer data", async () => {
    const analyticsRepository = {
      enqueuePostingViewedEvent: jest.fn(async () => undefined),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as any,
      {
        findPublicReadMetadataById: jest.fn(async () => createPublicPosting()),
      } as any,
      createOrganizationAccessService(),
    );
    const client = createClient();

    await service.trackPublicView(createPublicPosting(), client);

    expect(analyticsRepository.enqueuePostingViewedEvent).toHaveBeenCalledWith({
      postingId: POSTING_1_ID,
      organizationId: ORG_1_ID,
      occurredAt: "2026-05-20T14:30:00.000Z",
      viewerHash: hashValue(
        `posting:${POSTING_1_ID}|day:2026-05-20|ip:203.0.113.10|ua:Mozilla/5.0|device:${DEVICE_1_ID}`,
      ),
      userId: undefined,
      ipAddressHash: hashValue("ip:203.0.113.10"),
      userAgentHash: hashValue("ua:Mozilla/5.0"),
      deviceType: "desktop",
    });
  });

  it("skips public view tracking for owners, bots, and non-public postings", async () => {
    const analyticsRepository = {
      enqueuePostingViewedEvent: jest.fn(async () => undefined),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as any,
      {
        findPublicReadMetadataById: jest.fn(async () => createPublicPosting()),
      } as any,
      createOrganizationAccessService(),
    );

    await service.trackPublicView(
      createPublicPosting(),
      createClient(),
      OWNER_1_ID,
    );
    await service.trackPublicView(
      createPublicPosting(),
      createClient({
        device: {
          type: "bot",
          isMobile: false,
        },
      }),
    );
    await service.trackPublicView(
      createPublicPosting({
        status: "paused",
      }),
      createClient(),
    );

    expect(
      analyticsRepository.enqueuePostingViewedEvent,
    ).not.toHaveBeenCalled();
  });

  it("tracks search impressions only when postings are present", async () => {
    const analyticsRepository = {
      enqueueSearchImpressionEvent: jest.fn(async () => undefined),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as any,
      {
        findPublicReadMetadataById: jest.fn(async () => createPublicPosting()),
      } as any,
      createOrganizationAccessService(),
    );

    await service.trackSearchImpressions([]);
    await service.trackSearchImpressions([
      createPublicPosting(),
      createPublicPosting({
        id: POSTING_2_ID,
      }),
    ] as any);

    expect(
      analyticsRepository.enqueueSearchImpressionEvent,
    ).toHaveBeenCalledTimes(2);
    expect(
      analyticsRepository.enqueueSearchImpressionEvent,
    ).toHaveBeenNthCalledWith(1, {
      postingId: POSTING_1_ID,
      organizationId: ORG_1_ID,
      occurredAt: "2026-05-20T14:30:00.000Z",
    });
  });

  it("tracks search clicks only for publicly visible postings", async () => {
    const analyticsRepository = {
      enqueueSearchClickEvent: jest.fn(async () => undefined),
    };
    const postingsRepository = {
      findPublicReadMetadataById: jest
        .fn()
        .mockResolvedValueOnce(createPublicPosting())
        .mockResolvedValueOnce({
          id: POSTING_2_ID,
          organizationId: ORG_1_ID,
          status: "paused",
        }),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as any,
      postingsRepository as any,
      createOrganizationAccessService(),
    );

    await service.trackSearchClick(POSTING_1_ID);
    await service.trackSearchClick(POSTING_2_ID);

    expect(postingsRepository.findPublicReadMetadataById).toHaveBeenCalledTimes(
      2,
    );
    expect(analyticsRepository.enqueueSearchClickEvent).toHaveBeenCalledTimes(
      1,
    );
    expect(analyticsRepository.enqueueSearchClickEvent).toHaveBeenCalledWith({
      postingId: POSTING_1_ID,
      organizationId: ORG_1_ID,
      occurredAt: "2026-05-20T14:30:00.000Z",
    });
  });

  it("delegates owner summary and listing reads", async () => {
    const analyticsRepository = {
      getOwnerSummary: jest.fn(async () => ({ window: "30d" })),
      listOwnerPostingsAnalytics: jest.fn(async () => ({ postings: [] })),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as any,
      {} as any,
      createOrganizationAccessService(),
    );

    await expect(service.getOwnerSummary(OWNER_1_ID, "30d")).resolves.toEqual({
      window: "30d",
    });
    await expect(
      service.listOwnerPostingsAnalytics({
        actorUserId: OWNER_1_ID,
        window: "7d",
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      postings: [],
    });
  });

  it("enforces analytics detail existence, ownership, and hourly window rules", async () => {
    const analyticsRepository = {
      getPostingAnalyticsDetail: jest.fn(async () => ({
        postingId: POSTING_1_ID,
      })),
    };
    const postingsRepository = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createPublicPosting())
        .mockResolvedValueOnce({
          ...createPublicPosting(),
          organizationId: ORG_2_ID,
        })
        .mockResolvedValueOnce(createPublicPosting()),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as any,
      postingsRepository as any,
      createOrganizationAccessService(),
    );

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: POSTING_1_ID,
        actorUserId: OWNER_1_ID,
        window: "7d",
        granularity: "day",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: POSTING_1_ID,
        actorUserId: OWNER_1_ID,
        window: "7d",
        granularity: "day",
      }),
    ).resolves.toEqual({
      postingId: POSTING_1_ID,
    });

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: POSTING_1_ID,
        actorUserId: OWNER_1_ID,
        window: "7d",
        granularity: "day",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: POSTING_1_ID,
        actorUserId: OWNER_1_ID,
        window: "30d",
        granularity: "hour",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
