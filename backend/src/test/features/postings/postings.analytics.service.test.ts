import { createHash } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { PostingsAnalyticsService } from "@/features/postings/analytics/analytics.service";

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPublicPosting(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    ownerId: "owner-1",
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
      type: string;
      isMobile: boolean;
      userAgent?: string;
      platform?: string;
    };
  }>,
) {
  return {
    ip: "203.0.113.10",
    device: {
      id: "device-1",
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
      analyticsRepository as never,
      {} as never,
    );
    const client = createClient();

    await service.trackPublicView(createPublicPosting(), client);

    expect(analyticsRepository.enqueuePostingViewedEvent).toHaveBeenCalledWith({
      postingId: "posting-1",
      ownerId: "owner-1",
      occurredAt: "2026-05-20T14:30:00.000Z",
      viewerHash: hashValue(
        "posting:posting-1|day:2026-05-20|ip:203.0.113.10|ua:Mozilla/5.0|device:device-1",
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
      analyticsRepository as never,
      {} as never,
    );

    await service.trackPublicView(
      createPublicPosting(),
      createClient(),
      "owner-1",
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
      analyticsRepository as never,
      {} as never,
    );

    await service.trackSearchImpressions([]);
    await service.trackSearchImpressions([
      createPublicPosting(),
      createPublicPosting({
        id: "posting-2",
      }),
    ] as never);

    expect(
      analyticsRepository.enqueueSearchImpressionEvent,
    ).toHaveBeenCalledTimes(2);
    expect(
      analyticsRepository.enqueueSearchImpressionEvent,
    ).toHaveBeenNthCalledWith(1, {
      postingId: "posting-1",
      ownerId: "owner-1",
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
          id: "posting-2",
          ownerId: "owner-1",
          status: "paused",
        }),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as never,
      postingsRepository as never,
    );

    await service.trackSearchClick("posting-1");
    await service.trackSearchClick("posting-2");

    expect(postingsRepository.findPublicReadMetadataById).toHaveBeenCalledTimes(
      2,
    );
    expect(analyticsRepository.enqueueSearchClickEvent).toHaveBeenCalledTimes(
      1,
    );
    expect(analyticsRepository.enqueueSearchClickEvent).toHaveBeenCalledWith({
      postingId: "posting-1",
      ownerId: "owner-1",
      occurredAt: "2026-05-20T14:30:00.000Z",
    });
  });

  it("delegates owner summary and listing reads", async () => {
    const analyticsRepository = {
      getOwnerSummary: jest.fn(async () => ({ window: "30d" })),
      listOwnerPostingsAnalytics: jest.fn(async () => ({ postings: [] })),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as never,
      {} as never,
    );

    await expect(service.getOwnerSummary("owner-1", "30d")).resolves.toEqual({
      window: "30d",
    });
    await expect(
      service.listOwnerPostingsAnalytics({
        ownerId: "owner-1",
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
        postingId: "posting-1",
      })),
    };
    const postingsRepository = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createPublicPosting())
        .mockResolvedValueOnce({
          ...createPublicPosting(),
          ownerId: "owner-2",
        })
        .mockResolvedValueOnce(createPublicPosting()),
    };
    const service = new PostingsAnalyticsService(
      analyticsRepository as never,
      postingsRepository as never,
    );

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: "posting-1",
        ownerId: "owner-1",
        window: "7d",
        granularity: "day",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: "posting-1",
        ownerId: "owner-1",
        window: "7d",
        granularity: "day",
      }),
    ).resolves.toEqual({
      postingId: "posting-1",
    });

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: "posting-1",
        ownerId: "owner-1",
        window: "7d",
        granularity: "day",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      service.getPostingAnalyticsDetail({
        postingId: "posting-1",
        ownerId: "owner-1",
        window: "30d",
        granularity: "hour",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
