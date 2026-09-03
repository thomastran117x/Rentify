import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  MAX_BATCH_IDS,
  isPostingPubliclyVisible,
  toPublicPostingRecord,
} from "@/features/postings/postings.model";
import type {
  ActiveBookingRequestRange,
  AvailabilityBlockRange,
  AvailabilityCalendarPostingFields,
  ConfirmedRentingRange,
  PostingAvailabilityBlockInput,
  PostingAvailabilityBlockRecord,
  PostingRecord,
  PublicPostingRecord,
  UpsertPostingInput,
} from "@/features/postings/postings.model";
import type { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { PostingThumbnailQueueService } from "@/features/postings/thumbnail/thumbnail.queue.service";
import type { PostingsPublicSearchService } from "@/features/postings/search/public-search.service";
import { PostingsService } from "@/features/postings/postings.service";
import type { BlobService } from "@/features/blob/blob.service";
import type { CacheService } from "@/features/cache/cache.service";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import type { OrganizationsProfileRepository } from "@/features/organizations/profile/profile.repository";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import { testUuid } from "../../support/uuid";
const BLOCK_1_ID = testUuid(9000, 406415);
const BOOKING_HOLD_1_ID = testUuid(9000, 727880);
const OWNER_2_ID = testUuid(9000, 219202);
const RENTER_1_ID = testUuid(9000, 235000);
const MANAGER_1_ID = testUuid(9000, 836503);
const OWNER_1_ID = testUuid(9000, 219201);
const POSTING_123_ID = testUuid(9000, 361141);
const POSTING_1_ID = testUuid(9000, 254272);
const POSTING_SOURCE_ID = testUuid(9000, 905210);

const GHOST_USER_ID = testUuid(9000, 883810);
const MEMBERLESS_1_ID = testUuid(9000, 772440);
const OPERATOR_1_ID = testUuid(9000, 402986);
const ORG_2_ID = testUuid(9000, 9235);
const ORG_9_ID = testUuid(9000, 9242);

class FakePostingsRepository {
  createCalls = 0;
  lastCreateInput: UpsertPostingInput | null = null;
  lastListInput: {
    organizationId: string;
    page: number;
    pageSize: number;
    status?: PostingRecord["status"];
  } | null = null;
  updateCalls = 0;
  findByIdCalls = 0;
  publishCalls = 0;
  pauseCalls = 0;
  unpauseCalls = 0;
  archiveCalls = 0;
  createOwnerAvailabilityBlockCalls = 0;
  updateOwnerAvailabilityBlockCalls = 0;
  deleteOwnerAvailabilityBlockCalls = 0;
  ownerOverlap = false;
  bookingConflict = false;
  rentingConflict = false;
  posting = buildPostingRecord(createValidInput());
  ownerBlocks: PostingAvailabilityBlockRecord[] = [
    buildAvailabilityBlockRecord(BLOCK_1_ID, {
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-03T00:00:00.000Z",
    }),
  ];
  blockLookup: PostingAvailabilityBlockRecord | null = this.ownerBlocks[0]!;
  deleteResult = true;

  async create(input: UpsertPostingInput): Promise<PostingRecord> {
    this.createCalls += 1;
    this.lastCreateInput = input;
    return buildPostingRecord(input);
  }

  async update(id: string, input: UpsertPostingInput): Promise<PostingRecord> {
    this.updateCalls += 1;
    return {
      ...buildPostingRecord(input),
      id,
    };
  }

  async findById(id: string): Promise<PostingRecord> {
    this.findByIdCalls += 1;

    return {
      ...this.posting,
      id,
    };
  }

  async findPublicReadMetadataById(id: string): Promise<{
    id: string;
    organizationId: string;
    status: PostingRecord["status"];
    archivedAt?: string;
  }> {
    return {
      id,
      organizationId: this.posting.organizationId,
      status: this.posting.status,
      archivedAt: this.posting.archivedAt,
    };
  }

  calendarPostingMissing = false;
  calendarBlocks: AvailabilityBlockRange[] = [];
  calendarRentings: ConfirmedRentingRange[] = [];
  calendarBookingRequests: ActiveBookingRequestRange[] = [];
  lastCalendarBlocksRange: { startAt: Date; endAt: Date } | null = null;
  lastCalendarRentingsRange: { startAt: Date; endAt: Date } | null = null;
  lastCalendarBookingRequestsRange: { startAt: Date; endAt: Date } | null =
    null;

  async findAvailabilityCalendarPosting(
    id: string,
  ): Promise<AvailabilityCalendarPostingFields | null> {
    if (this.calendarPostingMissing) {
      return null;
    }

    return {
      id,
      organizationId: this.posting.organizationId,
      status: this.posting.status,
      archivedAt: this.posting.archivedAt,
      availabilityStatus: this.posting.availabilityStatus,
      advanceNoticeDays: this.posting.advanceNoticeDays,
      minBookingDurationDays: this.posting.minBookingDurationDays,
    };
  }

  async findAvailabilityBlocksInRange(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
  }): Promise<AvailabilityBlockRange[]> {
    this.lastCalendarBlocksRange = {
      startAt: input.startAt,
      endAt: input.endAt,
    };
    return this.calendarBlocks;
  }

  async findConfirmedRentingsInRange(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
  }): Promise<ConfirmedRentingRange[]> {
    this.lastCalendarRentingsRange = {
      startAt: input.startAt,
      endAt: input.endAt,
    };
    return this.calendarRentings;
  }

  async findActiveBookingRequestsInRange(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
  }): Promise<ActiveBookingRequestRange[]> {
    this.lastCalendarBookingRequestsRange = {
      startAt: input.startAt,
      endAt: input.endAt,
    };
    return this.calendarBookingRequests;
  }

  async publish(id: string): Promise<PostingRecord> {
    this.publishCalls += 1;
    this.posting = {
      ...this.posting,
      id,
      status: "published",
      publishedAt: this.posting.publishedAt ?? "2026-04-21T00:00:00.000Z",
      pausedAt: undefined,
      archivedAt: undefined,
    };
    return this.posting;
  }

  async pause(id: string): Promise<PostingRecord> {
    this.pauseCalls += 1;
    this.posting = {
      ...this.posting,
      id,
      status: "paused",
      publishedAt: this.posting.publishedAt ?? "2026-04-21T00:00:00.000Z",
      pausedAt: "2026-04-23T00:00:00.000Z",
      archivedAt: undefined,
    };
    return this.posting;
  }

  async unpause(id: string): Promise<PostingRecord> {
    this.unpauseCalls += 1;
    this.posting = {
      ...this.posting,
      id,
      status: "published",
      pausedAt: undefined,
      archivedAt: undefined,
    };
    return this.posting;
  }

  async archive(id: string): Promise<PostingRecord> {
    this.archiveCalls += 1;
    this.posting = {
      ...this.posting,
      id,
      status: "archived",
      pausedAt: undefined,
      archivedAt: "2026-04-23T00:00:00.000Z",
    };
    return this.posting;
  }

  async listOwnerAvailabilityBlocks(): Promise<
    PostingAvailabilityBlockRecord[]
  > {
    return this.ownerBlocks;
  }

  async listByOwner(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    status?: PostingRecord["status"];
    q?: string;
  }) {
    this.lastListInput = input;
    return {
      postings: [this.posting],
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      ...(input.status ? { status: input.status } : {}),
    };
  }

  lastCountOrganizationId: string | null = null;

  async countByOwnerStatus(organizationId: string) {
    this.lastCountOrganizationId = organizationId;
    return {
      total: 1,
      byStatus: { draft: 1, published: 0, paused: 0, archived: 0 },
    };
  }

  async findOwnerAvailabilityBlock(): Promise<PostingAvailabilityBlockRecord | null> {
    return this.blockLookup;
  }

  async createOwnerAvailabilityBlock(
    _postingId: string,
    input: PostingAvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlockRecord> {
    this.createOwnerAvailabilityBlockCalls += 1;
    return buildAvailabilityBlockRecord("created-block", input);
  }

  async updateOwnerAvailabilityBlock(
    _postingId: string,
    blockId: string,
    input: PostingAvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlockRecord> {
    this.updateOwnerAvailabilityBlockCalls += 1;
    return buildAvailabilityBlockRecord(blockId, input);
  }

  async deleteOwnerAvailabilityBlock(): Promise<boolean> {
    this.deleteOwnerAvailabilityBlockCalls += 1;
    return this.deleteResult;
  }

  async hasOwnerAvailabilityBlockOverlap(input: {
    excludeBlockId?: string;
  }): Promise<boolean> {
    if (input.excludeBlockId === BLOCK_1_ID) {
      return false;
    }

    return this.ownerOverlap;
  }

  async hasActiveBookingAvailabilityConflict(): Promise<boolean> {
    return this.bookingConflict;
  }

  async hasRentingAvailabilityConflict(): Promise<boolean> {
    return this.rentingConflict;
  }
}

class FakePostingsReviewsRepository {
  ownReview: { id: string } | null = null;

  async findOwnReview(): Promise<{ id: string } | null> {
    return this.ownReview;
  }
}

class FakeRentingsRepository {
  eligibleReviewRenting = false;

  async hasEligibleReviewRenting(): Promise<boolean> {
    return this.eligibleReviewRenting;
  }
}

class FakePostingsPublicCacheService {
  invalidatedPostingIds: string[] = [];
  posting: PublicPostingRecord | null = null;

  async getPublicById(): Promise<PublicPostingRecord | null> {
    return this.posting;
  }

  async getPublicByIds(
    ids: string[],
  ): Promise<{ postings: PublicPostingRecord[]; missingIds: string[] }> {
    if (!this.posting) {
      return {
        postings: [],
        missingIds: ids,
      };
    }

    const byId = new Map([[this.posting.id, this.posting]]);

    return {
      postings: ids
        .map((id) => byId.get(id))
        .filter(Boolean) as PublicPostingRecord[],
      missingIds: ids.filter((id) => !byId.has(id)),
    };
  }

  async invalidatePublic(postingId: string): Promise<number> {
    this.invalidatedPostingIds.push(postingId);
    return this.invalidatedPostingIds.length;
  }
}

class FakeAuthRepository {
  membershipsByUserId = new Map([
    [
      OWNER_1_ID,
      [
        {
          membershipId: "membership-1",
          organizationId: "org-1",
          organizationName: "Org 1",
          role: "primary_manager" as const,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    ],
    [
      MANAGER_1_ID,
      [
        {
          membershipId: "membership-2",
          organizationId: "org-1",
          organizationName: "Org 1",
          role: "manager" as const,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    ],
    [
      OPERATOR_1_ID,
      [
        {
          membershipId: "membership-3",
          organizationId: "org-1",
          organizationName: "Org 1",
          role: "operator" as const,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    ],
    [
      OWNER_2_ID,
      [
        {
          membershipId: "membership-4",
          organizationId: ORG_2_ID,
          organizationName: "Org 2",
          role: "primary_manager" as const,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    ],
  ]);
  preferredOrganizationIdByUserId = new Map<string, string>([
    [OWNER_1_ID, "org-1"],
    [MANAGER_1_ID, "org-1"],
    [OPERATOR_1_ID, "org-1"],
    [OWNER_2_ID, ORG_2_ID],
  ]);

  async findUserById(userId: string) {
    const organizationMemberships = this.membershipsByUserId.get(userId) ?? [];

    if (
      !this.preferredOrganizationIdByUserId.has(userId) &&
      organizationMemberships.length === 0
    ) {
      return null;
    }

    return {
      id: userId,
      email: `${userId}@example.com`,
      tokenVersion: 0,
      role: "user" as const,
      emailVerified: true,
      profile: {
        id: `profile-${userId}`,
        userId,
        username: userId,
        isPrivate: false,
        recommendationPersonalizationEnabled: true,
        trustworthinessScore: 1,
        rentPostingsCount: 0,
        availableRentPostingsCount: 0,
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
      },
      oauthIdentities: [],
      preferredOrganizationId:
        this.preferredOrganizationIdByUserId.get(userId) ?? undefined,
      organizationMemberships,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    };
  }
}

function createService(
  repository: FakePostingsRepository,
  postingsReviewsRepository = new FakePostingsReviewsRepository(),
  rentingsRepository = new FakeRentingsRepository(),
  searchService = {} as PostingsPublicSearchService,
): PostingsService {
  return createServiceHarness(
    repository,
    postingsReviewsRepository,
    rentingsRepository,
    searchService,
  ).service;
}

function createEmptySearchResponse() {
  return {
    postings: [],
    pagination: {
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    source: "elasticsearch" as const,
  };
}

function createOrganizationsRepositoryStub(
  overrides: {
    findOrganizationNameMatches?: jest.Mock;
    findOrganizationSummariesByIds?: jest.Mock;
  } = {},
) {
  return {
    findOrganizationNameMatches:
      overrides.findOrganizationNameMatches ??
      jest.fn(async () => ({ matches: [], truncated: false })),
    findOrganizationSummariesByIds:
      overrides.findOrganizationSummariesByIds ?? jest.fn(async () => []),
  };
}

function createServiceHarness(
  repository: FakePostingsRepository,
  postingsReviewsRepository = new FakePostingsReviewsRepository(),
  rentingsRepository = new FakeRentingsRepository(),
  searchService = {} as PostingsPublicSearchService,
  organizationsRepository = createOrganizationsRepositoryStub(),
) {
  const blobService = {
    isConfigured: () => true,
    isManagedBlobUrl: () => true,
  } as unknown as BlobService;
  const cacheService = {
    acquireLock: jest.fn(async (key: string) => ({
      key,
      token: `${key}-token`,
      release: jest.fn(async () => true),
      extend: jest.fn(async () => true),
    })),
  } as unknown as CacheService;
  const postingThumbnailQueueService = {
    enqueuePostingThumbnailJob: jest.fn(async () => undefined),
  };
  const postingsPublicCacheService = new FakePostingsPublicCacheService();
  const authRepository = new FakeAuthRepository();
  const organizationAccessService = new OrganizationAccessService(
    authRepository as unknown as UsersRepository,
  );
  postingsPublicCacheService.posting = isPostingPubliclyVisible(
    repository.posting,
  )
    ? toPublicPostingRecord(repository.posting)
    : null;

  return {
    service: new PostingsService(
      repository as unknown as PostingsRepository,
      searchService,
      postingsReviewsRepository as unknown as PostingsReviewsRepository,
      rentingsRepository as unknown as RentingsRepository,
      blobService,
      postingThumbnailQueueService as unknown as PostingThumbnailQueueService,
      new ContentSanitizationService(),
      cacheService,
      postingsPublicCacheService as unknown as PostingsPublicCacheService,
      organizationAccessService,
      authRepository as unknown as UsersRepository,
      {
        record: jest.fn(async () => undefined),
      } as unknown as OrganizationAuditService,
      organizationsRepository as unknown as OrganizationsProfileRepository,
    ),
    postingThumbnailQueueService,
    postingsPublicCacheService,
    organizationAccessService,
    authRepository,
    organizationsRepository,
  };
}

function createValidInput(): UpsertPostingInput {
  return {
    organizationId: "org-1",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "Sunny loft near transit",
    description:
      "Bright loft with large windows, private balcony, and storage locker.",
    pricing: {
      currency: "cad",
      daily: {
        amount: 125,
      },
    },
    photos: [
      {
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
      },
    ],
    tags: ["Loft", "Transit"],
    details: {
      guest_capacity: 2,
      property_type: "loft",
      furnished: true,
      pet_policy: "Cats allowed",
      amenities: ["washer", "dryer"],
    },
    availabilityStatus: "available",
    availabilityNotes: "Available immediately",
    maxBookingDurationDays: 14,
    availabilityBlocks: [
      {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        note: "Owner maintenance window",
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
  };
}

function buildPostingRecord(input: UpsertPostingInput): PostingRecord {
  return {
    id: POSTING_1_ID,
    organizationId: input.organizationId,
    status: "draft",
    variant: input.variant,
    name: input.name,
    description: input.description,
    pricing: input.pricing,
    pricingCurrency: input.pricing.currency,
    photos: input.photos.map((photo, index) => ({
      id: `photo-${index + 1}`,
      blobUrl: photo.blobUrl,
      blobName: photo.blobName,
      thumbnailBlobUrl: photo.thumbnailBlobUrl,
      thumbnailBlobName: photo.thumbnailBlobName,
      position: photo.position,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    })),
    tags: input.tags,
    details: input.details,
    availabilityStatus: input.availabilityStatus,
    availabilityNotes: input.availabilityNotes ?? undefined,
    maxBookingDurationDays: input.maxBookingDurationDays ?? undefined,
    effectiveMaxBookingDurationDays: input.maxBookingDurationDays ?? 30,
    availabilityBlocks: input.availabilityBlocks.map((block, index) => ({
      id: `block-${index + 1}`,
      startAt: block.startAt,
      endAt: block.endAt,
      note: block.note ?? undefined,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    })),
    location: input.location,
    instantBooking: input.instantBooking ?? false,
    reviewCount: 0,
    publishedAt: undefined,
    pausedAt: undefined,
    archivedAt: undefined,
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
  };
}

function buildAvailabilityBlockRecord(
  id: string,
  input: PostingAvailabilityBlockInput,
): PostingAvailabilityBlockRecord {
  return {
    id,
    startAt: input.startAt,
    endAt: input.endAt,
    note: input.note ?? undefined,
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
  };
}

function getValidationDetails(
  error: unknown,
): Array<{ path: string; message: string }> {
  expect(error).toBeInstanceOf(BadRequestError);
  expect(Array.isArray((error as BadRequestError).details)).toBe(true);
  return (error as BadRequestError).details as Array<{
    path: string;
    message: string;
  }>;
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  return null;
}

describe("PostingsService", () => {
  it("rejects unsafe content before create persists", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    input.description = "<script>alert('boom')</script>";

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    const details = getValidationDetails(error);
    expect(details[0]?.path).toBe("description");

    expect(repository.createCalls).toBe(0);
  });

  it("rejects unsafe attribute and block note paths on create", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    (
      input.details as Record<string, string | number | boolean | string[]>
    ).pet_policy = "No shitty behavior";
    input.availabilityBlocks[0]!.note = "javascript:alert('x')";

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    const details = getValidationDetails(error);
    expect(details.map((detail) => detail.path).sort()).toEqual([
      "availabilityBlocks.0.note",
      "details.pet_policy",
    ]);

    expect(repository.createCalls).toBe(0);
  });

  it("lets managers create organization-owned drafts in their active organization", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = {
      ...createValidInput(),
      organizationId: ORG_2_ID,
    };

    const created = await service.createDraft(MANAGER_1_ID, input);

    expect(created.organizationId).toBe("org-1");
    expect(repository.lastCreateInput).toMatchObject({
      organizationId: "org-1",
    });
  });

  it("blocks operators from creating drafts", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();

    await expect(
      service.createDraft(OPERATOR_1_ID, input),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createCalls).toBe(0);
  });

  it("lists postings for the caller's active organization", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await service.listByOwner(MANAGER_1_ID, {
      page: 1,
      pageSize: 20,
      status: "draft",
    });

    expect(repository.lastListInput).toEqual({
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
      status: "draft",
    });
  });

  it("passes the search query through to the repository", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await service.listByOwner(MANAGER_1_ID, {
      page: 1,
      pageSize: 20,
      q: "studio",
    });

    expect(repository.lastListInput).toEqual({
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
      q: "studio",
    });
  });

  it("summarizes posting counts for the caller's active organization", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const summary = await service.getOwnerStatusSummary(MANAGER_1_ID);

    expect(repository.lastCountOrganizationId).toBe("org-1");
    expect(summary).toEqual({
      total: 1,
      byStatus: { draft: 1, published: 0, paused: 0, archived: 0 },
    });
  });

  it("rejects unsafe content before update persists", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    input.tags = ["safe", "' OR 1=1 --"];

    const error = await service
      .update(POSTING_123_ID, OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    const details = getValidationDetails(error);
    expect(details[0]?.path).toBe("tags.1");

    expect(repository.findByIdCalls).toBe(1);
    expect(repository.updateCalls).toBe(0);
  });

  it("accepts clean content and persists normalized data", async () => {
    const repository = new FakePostingsRepository();
    const {
      service,
      postingThumbnailQueueService,
      postingsPublicCacheService,
    } = createServiceHarness(repository);
    const input = createValidInput();
    input.tags = ["  Loft  ", "loft", "Transit"];

    const created = await service.createDraft(OWNER_1_ID, input);

    expect(repository.createCalls).toBe(1);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith(POSTING_1_ID);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
    expect(created.tags).toEqual(["loft", "transit"]);
  });

  it("persists minBookingDurationDays, advanceNoticeDays, and cancellationPolicy on create", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input: UpsertPostingInput = {
      ...createValidInput(),
      minBookingDurationDays: 3,
      advanceNoticeDays: 2,
      cancellationPolicy: "moderate",
      cancellationPolicyNotes: "50% refund within 48h.",
    };

    await service.createDraft(OWNER_1_ID, input);

    expect(repository.lastCreateInput).toMatchObject({
      minBookingDurationDays: 3,
      advanceNoticeDays: 2,
      cancellationPolicy: "moderate",
      cancellationPolicyNotes: "50% refund within 48h.",
    });
  });

  it("rejects when minBookingDurationDays exceeds maxBookingDurationDays", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input: UpsertPostingInput = {
      ...createValidInput(),
      minBookingDurationDays: 10,
      maxBookingDurationDays: 5,
    };

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).message).toContain(
      "Minimum booking duration cannot exceed maximum booking duration.",
    );
    expect(repository.createCalls).toBe(0);
  });

  it("accepts when minBookingDurationDays equals maxBookingDurationDays", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input: UpsertPostingInput = {
      ...createValidInput(),
      minBookingDurationDays: 7,
      maxBookingDurationDays: 7,
    };

    await expect(service.createDraft(OWNER_1_ID, input)).resolves.toBeDefined();
    expect(repository.createCalls).toBe(1);
  });

  it("rejects when minBookingDurationDays is set without maxBookingDurationDays and the value is still valid alone", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input: UpsertPostingInput = {
      ...createValidInput(),
      minBookingDurationDays: 3,
      maxBookingDurationDays: null,
    };

    await expect(service.createDraft(OWNER_1_ID, input)).resolves.toBeDefined();
    expect(repository.createCalls).toBe(1);
  });

  it("rejects advanceNoticeDays that is out of allowed range", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input: UpsertPostingInput = {
      ...createValidInput(),
      advanceNoticeDays: 400,
    };

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).message).toContain("Advance notice");
    expect(repository.createCalls).toBe(0);
  });

  it("accepts advanceNoticeDays of 0 (same-day booking)", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input: UpsertPostingInput = {
      ...createValidInput(),
      advanceNoticeDays: 0,
    };

    await expect(service.createDraft(OWNER_1_ID, input)).resolves.toBeDefined();
    expect(repository.createCalls).toBe(1);
  });

  it("duplicates an owner posting into a new draft with owner-authored availability and copied photos", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_SOURCE_ID,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
      photos: repository.posting.photos.map((photo) => ({
        ...photo,
        thumbnailBlobName: "postings/thumbnails/photo-1.webp",
        thumbnailBlobUrl:
          "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
      })),
      availabilityBlocks: [
        buildAvailabilityBlockRecord("hold-1", {
          startAt: "2026-06-10T00:00:00.000Z",
          endAt: "2026-06-12T00:00:00.000Z",
          note: "Temporary booking hold",
        }),
      ],
    };
    repository.ownerBlocks = [
      buildAvailabilityBlockRecord("owner-block-1", {
        startAt: "2026-07-01T00:00:00.000Z",
        endAt: "2026-07-03T00:00:00.000Z",
        note: "Owner stay",
      }),
    ];
    const {
      service,
      postingThumbnailQueueService,
      postingsPublicCacheService,
    } = createServiceHarness(repository);

    const duplicated = await service.duplicate(POSTING_SOURCE_ID, OWNER_1_ID);

    expect(repository.findByIdCalls).toBe(1);
    expect(repository.createCalls).toBe(1);
    expect(repository.lastCreateInput).toMatchObject({
      organizationId: "org-1",
      variant: repository.posting.variant,
      name: repository.posting.name,
      description: repository.posting.description,
      pricing: {
        ...repository.posting.pricing,
        currency: "CAD",
      },
      tags: ["loft", "transit"],
      details: repository.posting.details,
      availabilityStatus: repository.posting.availabilityStatus,
      availabilityNotes: repository.posting.availabilityNotes,
      maxBookingDurationDays: repository.posting.maxBookingDurationDays,
      location: repository.posting.location,
      photos: repository.posting.photos.map((photo) => ({
        blobUrl: photo.blobUrl,
        blobName: photo.blobName,
        thumbnailBlobUrl: photo.thumbnailBlobUrl,
        thumbnailBlobName: photo.thumbnailBlobName,
        position: photo.position,
      })),
      availabilityBlocks: repository.ownerBlocks.map((block) => ({
        startAt: block.startAt,
        endAt: block.endAt,
        note: block.note,
      })),
    });
    expect(duplicated.id).toBe(POSTING_1_ID);
    expect(duplicated.status).toBe("draft");
    expect(duplicated.publishedAt).toBeUndefined();
    expect(duplicated.photos).toHaveLength(repository.posting.photos.length);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith(duplicated.id);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      duplicated.id,
    ]);
    expect(duplicated.availabilityBlocks).toEqual([
      expect.objectContaining({
        startAt: "2026-07-01T00:00:00.000Z",
        endAt: "2026-07-03T00:00:00.000Z",
        note: "Owner stay",
      }),
    ]);
  });

  it("does not allow duplicating another owner's posting", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      organizationId: ORG_2_ID,
    };
    const service = createService(repository);

    await expect(
      service.duplicate(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createCalls).toBe(0);
  });

  it("pauses a published posting while preserving its published timestamp", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const paused = await service.pause(POSTING_1_ID, OWNER_1_ID);

    expect(paused.status).toBe("paused");
    expect(paused.publishedAt).toBe("2026-04-21T00:00:00.000Z");
    expect(paused.pausedAt).toBeDefined();
    expect(repository.pauseCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
  });

  it("unpauses a paused posting without changing its original published timestamp", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "paused",
      publishedAt: "2026-04-21T00:00:00.000Z",
      pausedAt: "2026-04-23T00:00:00.000Z",
    };
    const {
      service,
      postingThumbnailQueueService,
      postingsPublicCacheService,
    } = createServiceHarness(repository);

    const unpaused = await service.unpause(POSTING_1_ID, OWNER_1_ID);

    expect(unpaused.status).toBe("published");
    expect(unpaused.publishedAt).toBe("2026-04-21T00:00:00.000Z");
    expect(unpaused.pausedAt).toBeUndefined();
    expect(repository.unpauseCalls).toBe(1);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith(POSTING_1_ID);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
  });

  it("publishes a draft posting and enqueues thumbnail generation", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "draft",
    };
    const {
      service,
      postingThumbnailQueueService,
      postingsPublicCacheService,
    } = createServiceHarness(repository);

    const published = await service.publish(POSTING_1_ID, OWNER_1_ID);

    expect(published.status).toBe("published");
    expect(repository.publishCalls).toBe(1);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith(POSTING_1_ID);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
  });

  it("rejects invalid posting lifecycle transitions", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    repository.posting = {
      ...repository.posting,
      status: "paused",
    };
    await expect(
      service.publish(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(BadRequestError);

    repository.posting = {
      ...repository.posting,
      status: "draft",
    };
    await expect(
      service.pause(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(BadRequestError);

    repository.posting = {
      ...repository.posting,
      status: "published",
    };
    await expect(
      service.unpause(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("hides paused postings from public getById while still allowing owners to view them", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "paused",
      publishedAt: "2026-04-21T00:00:00.000Z",
      pausedAt: "2026-04-23T00:00:00.000Z",
    };
    const service = createService(repository);

    await expect(
      service.getById(POSTING_1_ID, RENTER_1_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    const ownerView = await service.getById(POSTING_1_ID, OWNER_1_ID);
    expect(ownerView.status).toBe("paused");
  });

  it("bypasses the public cache for owner getById reads", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "draft",
    };
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);
    postingsPublicCacheService.posting = null;

    const posting = await service.getById(POSTING_1_ID, OWNER_1_ID);

    expect(posting.status).toBe("draft");
    expect(repository.findByIdCalls).toBe(1);
  });

  it("uses the cached public projection for anonymous getById reads", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);
    postingsPublicCacheService.posting = {
      ...toPublicPostingRecord(repository.posting),
      name: "Cached name",
    };

    const posting = await service.getById(POSTING_1_ID);

    expect(posting).toMatchObject({
      id: POSTING_1_ID,
      name: "Cached name",
    });
    expect(repository.findByIdCalls).toBe(0);
  });

  it("includes viewer review state for an eligible renter on public getById", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const postingsReviewsRepository = new FakePostingsReviewsRepository();
    postingsReviewsRepository.ownReview = { id: "review-1" };
    const rentingsRepository = new FakeRentingsRepository();
    rentingsRepository.eligibleReviewRenting = true;
    const service = createService(
      repository,
      postingsReviewsRepository,
      rentingsRepository,
    );

    const posting = await service.getById(POSTING_1_ID, RENTER_1_ID);

    expect("viewerReviewState" in posting).toBe(true);
    expect("viewerReviewState" in posting && posting.viewerReviewState).toEqual(
      {
        eligible: true,
        hasOwnReview: true,
      },
    );
  });

  it("omits viewer review state for anonymous public getById", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const service = createService(repository);

    const posting = await service.getById(POSTING_1_ID);

    expect("viewerReviewState" in posting).toBe(false);
  });

  it("includes viewer review state for an ineligible renter on public getById", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const service = createService(repository);

    const posting = await service.getById(POSTING_1_ID, RENTER_1_ID);

    expect("viewerReviewState" in posting && posting.viewerReviewState).toEqual(
      {
        eligible: false,
        hasOwnReview: false,
      },
    );
  });

  it("rejects subtypes that do not belong to the selected family", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    input.variant = {
      family: "place",
      subtype: "car",
    };

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    const details = getValidationDetails(error);
    expect(details[0]?.path).toBe("variant.subtype");
    expect(repository.createCalls).toBe(0);
  });

  it("rejects invalid searchable attribute types for the selected variant", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    (input.details as Record<string, unknown>).guest_capacity = "four";

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    const details = getValidationDetails(error);
    expect(details[0]?.path).toBe("details.guest_capacity");
    expect(repository.createCalls).toBe(0);
  });

  it("rejects reserved detail keys before persisting", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    Object.assign(input.details as Record<string, unknown>, {
      constructor: "boom",
    });

    const error = await service
      .createDraft(OWNER_1_ID, input)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    const details = getValidationDetails(error);
    expect(details[0]?.path).toBe("details.constructor");
    expect(repository.createCalls).toBe(0);
  });

  it("keeps unknown details while normalizing searchable variant details", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    input.details = {
      guest_capacity: 4,
      property_type: "loft",
      amenities: [" WiFi ", "WiFi", " Desk "],
      ownerNote: "  Bring ID  ",
    };

    const created = await service.createDraft(OWNER_1_ID, input);

    expect(created.details).toEqual({
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["WiFi", "Desk"],
      ownerNote: "Bring ID",
    });
  });

  it("rejects nearest sorting when search coordinates are missing", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const error = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        sort: "nearest",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).message).toBe(
      "Nearest sorting requires latitude and longitude.",
    );
  });

  it("trims the public search query and normalizes tags before delegating search", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
      query: "Saint-Roch Production Flat",
    }));
    const service = createService(repository, undefined, undefined, {
      searchPublic,
    } as unknown as PostingsPublicSearchService);

    await service.searchPublic({
      page: 1,
      pageSize: 10,
      query: "  Saint-Roch Production Flat  ",
      tags: [" Flat ", "Production", "  "],
      sort: "relevance",
    });

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Saint-Roch Production Flat",
        tags: ["flat", "production"],
      }),
    );
  });

  it("resolves an organization name to ids before delegating search", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => createEmptySearchResponse());
    const findOrganizationNameMatches = jest.fn(async () => ({
      matches: [
        { id: "org-1", name: "Maya Santos Organization", slug: "maya-santos" },
        { id: ORG_2_ID, name: "Maya Santos Rentals", slug: "maya-santos-2" },
      ],
      truncated: true,
    }));
    const organizationsRepository = createOrganizationsRepositoryStub({
      findOrganizationNameMatches,
    });
    const { service } = createServiceHarness(
      repository,
      undefined,
      undefined,
      { searchPublic } as unknown as PostingsPublicSearchService,
      organizationsRepository,
    );

    await service.searchPublic({
      page: 1,
      pageSize: 10,
      sort: "relevance",
      organizationQuery: "  Maya Santos  ",
    });

    expect(findOrganizationNameMatches).toHaveBeenCalledWith("Maya Santos", 25);
    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationIds: ["org-1", ORG_2_ID],
        organizationFilter: expect.objectContaining({
          query: "Maya Santos",
          truncated: true,
        }),
      }),
    );
  });

  it("prefers an explicit organization id over a typed organization name", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => createEmptySearchResponse());
    const findOrganizationNameMatches = jest.fn(async () => ({
      matches: [],
      truncated: false,
    }));
    const findOrganizationSummariesByIds = jest.fn(async () => [
      { id: ORG_9_ID, name: "Elliot Chen Organization", slug: "elliot-chen" },
    ]);
    const organizationsRepository = createOrganizationsRepositoryStub({
      findOrganizationNameMatches,
      findOrganizationSummariesByIds,
    });
    const { service } = createServiceHarness(
      repository,
      undefined,
      undefined,
      { searchPublic } as unknown as PostingsPublicSearchService,
      organizationsRepository,
    );

    await service.searchPublic({
      page: 1,
      pageSize: 10,
      sort: "relevance",
      organizationQuery: "Maya Santos",
      organizationId: ORG_9_ID,
    });

    expect(findOrganizationSummariesByIds).toHaveBeenCalledWith([ORG_9_ID]);
    expect(findOrganizationNameMatches).not.toHaveBeenCalled();
    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationIds: [ORG_9_ID],
      }),
    );
  });

  it("returns an empty page without searching when no organization matches", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => createEmptySearchResponse());
    const organizationsRepository = createOrganizationsRepositoryStub();
    const { service } = createServiceHarness(
      repository,
      undefined,
      undefined,
      { searchPublic } as unknown as PostingsPublicSearchService,
      organizationsRepository,
    );

    const result = await service.searchPublic({
      page: 2,
      pageSize: 10,
      sort: "relevance",
      organizationQuery: "Nonexistent Org",
    });

    // Querying either engine with an empty id list is wasted work, and an empty
    // SQL `IN ()` would throw.
    expect(searchPublic).not.toHaveBeenCalled();
    expect(result).toEqual({
      postings: [],
      pagination: {
        page: 2,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      source: "database",
      organizationFilter: {
        query: "Nonexistent Org",
        matches: [],
        truncated: false,
      },
    });
  });

  it("normalizes searchable string and string-array filters before search", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const service = createService(repository, undefined, undefined, {
      searchPublic,
    } as unknown as PostingsPublicSearchService);

    await service.searchPublic({
      page: 1,
      pageSize: 10,
      family: "place",
      subtype: "entire_place",
      attributeFilters: [
        {
          key: "property_type",
          value: " Condo ",
        },
        {
          key: "amenities",
          value: [" WiFi ", "Desk", "wifi"],
        },
      ],
      sort: "relevance",
    });

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        attributeFilters: [
          {
            key: "property_type",
            value: "condo",
          },
          {
            key: "amenities",
            value: ["wifi", "desk"],
          },
        ],
      }),
    );
  });

  it("rejects attribute filters when family and subtype are missing", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const error = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        attributeFilters: [
          {
            key: "bedrooms",
            min: 2,
          },
        ],
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).details).toEqual([
      {
        path: "attr",
        message: "Attribute filters require both family and subtype.",
      },
    ]);
  });

  it("rejects inverted public search price ranges", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const error = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        minDailyPrice: 300,
        maxDailyPrice: 100,
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).message).toBe(
      "Minimum daily price cannot exceed maximum daily price.",
    );
  });

  it("rejects invalid public search availability windows", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const error = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        availabilityWindow: {
          startAt: "2026-07-05T00:00:00.000Z",
          endAt: "2026-07-01T00:00:00.000Z",
        },
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).message).toBe(
      "Availability window must define a valid, non-empty range.",
    );
  });

  it("accepts public search requests at the maximum supported result window boundary", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 200,
        pageSize: 50,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      source: "elasticsearch" as const,
    }));
    const service = createService(repository, undefined, undefined, {
      searchPublic,
    } as unknown as PostingsPublicSearchService);

    await service.searchPublic({
      page: 200,
      pageSize: 50,
      sort: "relevance",
    });

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 200,
        pageSize: 50,
      }),
    );
  });

  it("rejects public search requests beyond the maximum supported result window", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const error = await service
      .searchPublic({
        page: 201,
        pageSize: 50,
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).details).toEqual([
      {
        path: "page",
        message:
          "Requested page exceeds the maximum search window of 10000 results.",
      },
    ]);
  });

  it("lists owner availability blocks without a full posting payload", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const result = await service.listOwnerAvailabilityBlocks(
      POSTING_1_ID,
      OWNER_1_ID,
    );

    expect(result.availabilityBlocks).toEqual(repository.ownerBlocks);
    expect(repository.findByIdCalls).toBe(1);
  });

  it("creates an owner availability block after validating conflicts", async () => {
    const repository = new FakePostingsRepository();
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const created = await service.createOwnerAvailabilityBlock(
      POSTING_1_ID,
      OWNER_1_ID,
      {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
        note: "  maintenance  ",
      },
    );

    expect(created).toMatchObject({
      id: "created-block",
      note: "maintenance",
    });
    expect(repository.createOwnerAvailabilityBlockCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
  });

  it("rejects owner availability blocks that overlap another owner block", async () => {
    const repository = new FakePostingsRepository();
    repository.ownerOverlap = true;
    const service = createService(repository);

    const error = await service
      .createOwnerAvailabilityBlock(POSTING_1_ID, OWNER_1_ID, {
        startAt: "2026-05-02T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(BadRequestError);
    expect(repository.createOwnerAvailabilityBlockCalls).toBe(0);
  });

  it("rejects owner availability blocks that conflict with active bookings", async () => {
    const repository = new FakePostingsRepository();
    repository.bookingConflict = true;
    const service = createService(repository);

    const error = await service
      .createOwnerAvailabilityBlock(POSTING_1_ID, OWNER_1_ID, {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(ConflictError);
    expect(repository.createOwnerAvailabilityBlockCalls).toBe(0);
  });

  it("rejects owner availability blocks that conflict with confirmed rentings", async () => {
    const repository = new FakePostingsRepository();
    repository.rentingConflict = true;
    const service = createService(repository);

    const error = await service
      .createOwnerAvailabilityBlock(POSTING_1_ID, OWNER_1_ID, {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(ConflictError);
    expect(repository.createOwnerAvailabilityBlockCalls).toBe(0);
  });

  it("updates an owner availability block while excluding itself from overlap checks", async () => {
    const repository = new FakePostingsRepository();
    repository.ownerOverlap = true;
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const updated = await service.updateOwnerAvailabilityBlock(
      POSTING_1_ID,
      OWNER_1_ID,
      BLOCK_1_ID,
      {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
      },
    );

    expect(updated.id).toBe(BLOCK_1_ID);
    expect(repository.updateOwnerAvailabilityBlockCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
  });

  it("does not update or delete non-owner availability blocks", async () => {
    const repository = new FakePostingsRepository();
    repository.blockLookup = null;
    repository.deleteResult = false;
    const service = createService(repository);

    await expect(
      service.updateOwnerAvailabilityBlock(
        POSTING_1_ID,
        OWNER_1_ID,
        BOOKING_HOLD_1_ID,
        {
          startAt: "2026-05-01T00:00:00.000Z",
          endAt: "2026-05-04T00:00:00.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await expect(
      service.deleteOwnerAvailabilityBlock(
        POSTING_1_ID,
        OWNER_1_ID,
        BOOKING_HOLD_1_ID,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns a conflict when the posting availability lock is busy", async () => {
    const repository = new FakePostingsRepository();
    const searchService = {} as PostingsPublicSearchService;
    const blobService = {
      isConfigured: () => true,
      isManagedBlobUrl: () => true,
    } as unknown as BlobService;
    const cacheService = {
      acquireLock: jest.fn(async () => null),
    } as unknown as CacheService;
    const postingThumbnailQueueService = {
      enqueuePostingThumbnailJob: jest.fn(async () => undefined),
    } as unknown as PostingThumbnailQueueService;
    const postingsPublicCacheService = new FakePostingsPublicCacheService();
    const authRepository = new FakeAuthRepository();
    const organizationAccessService = new OrganizationAccessService(
      authRepository as unknown as UsersRepository,
    );
    postingsPublicCacheService.posting = isPostingPubliclyVisible(
      repository.posting,
    )
      ? toPublicPostingRecord(repository.posting)
      : null;
    const service = new PostingsService(
      repository as unknown as PostingsRepository,
      searchService,
      {} as unknown as PostingsReviewsRepository,
      {} as unknown as RentingsRepository,
      blobService,
      postingThumbnailQueueService,
      new ContentSanitizationService(),
      cacheService,
      postingsPublicCacheService as unknown as PostingsPublicCacheService,
      organizationAccessService,
      authRepository as unknown as UsersRepository,
      {
        record: jest.fn(async () => undefined),
      } as unknown as OrganizationAuditService,
      createOrganizationsRepositoryStub() as unknown as OrganizationsProfileRepository,
    );

    await expect(
      service.createOwnerAvailabilityBlock(POSTING_1_ID, OWNER_1_ID, {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("archives managed postings and invalidates the public projection", async () => {
    const repository = new FakePostingsRepository();
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const archived = await service.archive(POSTING_1_ID, OWNER_1_ID);

    expect(archived.status).toBe("archived");
    expect(repository.archiveCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      POSTING_1_ID,
    ]);
  });

  it("rejects archive when the repository no longer returns the posting", async () => {
    const repository = new FakePostingsRepository();
    repository.archive = jest.fn(async () => null) as any;
    const service = createService(repository);

    await expect(
      service.archive(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("normalizes owner batch ids before reading managed postings", async () => {
    const repository =
      new FakePostingsRepository() as FakePostingsRepository & {
        batchFindByOwner: jest.Mock;
      };
    repository.batchFindByOwner = jest.fn(async (input) => ({
      postings: [repository.posting],
      missingIds: input.ids.filter((id: string) => id === "posting-3"),
    }));
    const service = createService(repository);

    const result = await service.batchByOwner(OWNER_1_ID, [
      ` ${POSTING_1_ID} `,
      POSTING_1_ID,
      "posting-3",
    ]);

    expect(repository.batchFindByOwner).toHaveBeenCalledWith({
      organizationId: "org-1",
      ids: [POSTING_1_ID, "posting-3"],
    });
    expect(result.missingIds).toEqual(["posting-3"]);
  });

  it("normalizes public batch ids before reading cached projections", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const { service } = createServiceHarness(repository);

    const result = await service.batchPublic([
      ` ${POSTING_1_ID} `,
      POSTING_1_ID,
      "posting-missing",
    ]);

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.id).toBe(POSTING_1_ID);
    expect(result.missingIds).toEqual(["posting-missing"]);
  });

  it("rejects blank public batch ids", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await expect(service.batchPublic([" ", "\n"])).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("requires an active membership when listing owner postings", async () => {
    const repository = new FakePostingsRepository();
    const { service, authRepository } = createServiceHarness(repository);
    authRepository.membershipsByUserId.set(MEMBERLESS_1_ID, []);
    authRepository.preferredOrganizationIdByUserId.set(
      MEMBERLESS_1_ID,
      "org-1",
    );

    await expect(
      service.listByOwner(MEMBERLESS_1_ID, {
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects owner reads when the user record cannot be found", async () => {
    const repository = new FakePostingsRepository();
    const { service, authRepository } = createServiceHarness(repository);
    authRepository.membershipsByUserId.delete(GHOST_USER_ID);
    authRepository.preferredOrganizationIdByUserId.delete(GHOST_USER_ID);

    await expect(
      service.listByOwner(GHOST_USER_ID, {
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns not found when public-read metadata is missing for an authenticated viewer", async () => {
    const repository = new FakePostingsRepository();
    repository.findPublicReadMetadataById = jest.fn(async () => null) as any;
    const service = createService(repository);

    await expect(
      service.getById(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns not found when an owner viewer can see metadata but the posting row disappears", async () => {
    const repository = new FakePostingsRepository();
    repository.findById = jest.fn(async () => null) as any;
    const service = createService(repository);

    await expect(
      service.getById(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns not found when no public projection exists for anonymous reads", async () => {
    const repository = new FakePostingsRepository();
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);
    postingsPublicCacheService.posting = null;

    await expect(service.getById(POSTING_1_ID)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("swallows thumbnail queue failures after create succeeds", async () => {
    const repository = new FakePostingsRepository();
    const searchService = {} as PostingsPublicSearchService;
    const blobService = {
      isConfigured: () => true,
      isManagedBlobUrl: () => true,
    } as unknown as BlobService;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const postingThumbnailQueueService = {
      enqueuePostingThumbnailJob: jest.fn(async () => {
        throw new Error("queue unavailable");
      }),
    } as unknown as PostingThumbnailQueueService;
    const postingsPublicCacheService = new FakePostingsPublicCacheService();
    const authRepository = new FakeAuthRepository();
    const organizationAccessService = new OrganizationAccessService(
      authRepository as unknown as UsersRepository,
    );
    postingsPublicCacheService.posting = isPostingPubliclyVisible(
      repository.posting,
    )
      ? toPublicPostingRecord(repository.posting)
      : null;
    const service = new PostingsService(
      repository as unknown as PostingsRepository,
      searchService,
      {} as unknown as PostingsReviewsRepository,
      {} as unknown as RentingsRepository,
      blobService,
      postingThumbnailQueueService,
      new ContentSanitizationService(),
      cacheService,
      postingsPublicCacheService as unknown as PostingsPublicCacheService,
      organizationAccessService,
      authRepository as unknown as UsersRepository,
      {
        record: jest.fn(async () => undefined),
      } as unknown as OrganizationAuditService,
      createOrganizationsRepositoryStub() as unknown as OrganizationsProfileRepository,
    );

    await expect(
      service.createDraft(OWNER_1_ID, createValidInput()),
    ).resolves.toMatchObject({
      id: POSTING_1_ID,
    });
    expect(repository.createCalls).toBe(1);
  });

  it("rejects attribute filters that mix exact values with ranges", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const error = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        family: "place",
        subtype: "entire_place",
        attributeFilters: [
          {
            key: "guest_capacity",
            value: 2,
            min: 1,
          },
        ],
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as RequestValidationError).details).toEqual([
      {
        path: "attr.guest_capacity",
        message:
          "Exact attribute filters cannot be combined with min/max range filters.",
      },
    ]);
  });

  it("normalizes numeric search attribute filters before delegating search", async () => {
    const repository = new FakePostingsRepository();
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const service = createService(repository, undefined, undefined, {
      searchPublic,
    } as unknown as PostingsPublicSearchService);

    await service.searchPublic({
      page: 1,
      pageSize: 10,
      family: "place",
      subtype: "entire_place",
      attributeFilters: [
        {
          key: "guest_capacity",
          min: 2,
          max: 5,
        },
      ],
      sort: "relevance",
    });

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        attributeFilters: [
          {
            key: "guest_capacity",
            min: 2,
            max: 5,
          },
        ],
      }),
    );
  });

  it("rejects invalid attribute keys and non-numeric values in public search filters", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const invalidKeyError = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        family: "place",
        subtype: "entire_place",
        attributeFilters: [
          {
            key: "unknown_detail",
            value: "x",
          },
        ],
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);
    expect(invalidKeyError).toBeInstanceOf(RequestValidationError);
    expect((invalidKeyError as RequestValidationError).details).toEqual([
      {
        path: "attr.unknown_detail",
        message: "Attribute is not valid for the selected family and subtype.",
      },
    ]);

    const invalidNumericError = await service
      .searchPublic({
        page: 1,
        pageSize: 10,
        family: "place",
        subtype: "entire_place",
        attributeFilters: [
          {
            key: "guest_capacity",
            value: true,
          },
        ],
        sort: "relevance",
      })
      .catch((caughtError: unknown) => caughtError);
    expect(invalidNumericError).toBeInstanceOf(RequestValidationError);
    expect((invalidNumericError as RequestValidationError).details).toEqual([
      {
        path: "attr.guest_capacity",
        message: "Numeric attributes must be valid numbers.",
      },
    ]);
  });

  it("surfaces missing-row conflicts for write operations after authorization succeeds", async () => {
    const updateRepository = new FakePostingsRepository();
    updateRepository.update = jest.fn(async () => null) as any;
    const updateService = createService(updateRepository);

    await expect(
      updateService.update(POSTING_1_ID, OWNER_1_ID, createValidInput()),
    ).rejects.toThrow("Posting could not be found.");

    const blockRepository = new FakePostingsRepository();
    blockRepository.updateOwnerAvailabilityBlock = jest.fn(
      async () => null,
    ) as any;
    const blockService = createService(blockRepository);

    await expect(
      blockService.updateOwnerAvailabilityBlock(
        POSTING_1_ID,
        OWNER_1_ID,
        BLOCK_1_ID,
        {
          startAt: "2026-05-04T00:00:00.000Z",
          endAt: "2026-05-05T00:00:00.000Z",
        },
      ),
    ).rejects.toThrow(
      "This availability block changed before the update could be completed.",
    );

    const deleteRepository = new FakePostingsRepository();
    deleteRepository.deleteResult = false;
    const deleteService = createService(deleteRepository);

    await expect(
      deleteService.deleteOwnerAvailabilityBlock(
        POSTING_1_ID,
        OWNER_1_ID,
        BLOCK_1_ID,
      ),
    ).rejects.toThrow("Availability block could not be found.");

    const publishRepository = new FakePostingsRepository();
    publishRepository.publish = jest.fn(async () => null) as any;
    const publishService = createService(publishRepository);

    await expect(
      publishService.publish(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toThrow("Posting could not be found.");

    const pauseRepository = new FakePostingsRepository();
    pauseRepository.posting = {
      ...pauseRepository.posting,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    pauseRepository.pause = jest.fn(async () => null) as any;
    const pauseService = createService(pauseRepository);

    await expect(pauseService.pause(POSTING_1_ID, OWNER_1_ID)).rejects.toThrow(
      "Posting could not be found.",
    );

    const unpauseRepository = new FakePostingsRepository();
    unpauseRepository.posting = {
      ...unpauseRepository.posting,
      status: "paused",
      pausedAt: "2026-04-23T00:00:00.000Z",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    unpauseRepository.unpause = jest.fn(async () => null) as any;
    const unpauseService = createService(unpauseRepository);

    await expect(
      unpauseService.unpause(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toThrow("Posting could not be found.");
  });

  it("covers posting draft and asset validation helper branches", async () => {
    const service = createService(new FakePostingsRepository()) as unknown as {
      normalizePhotos: (photos: Array<Record<string, unknown>>) => unknown[];
      normalizeAvailabilityBlocks: (
        blocks: PostingAvailabilityBlockInput[],
      ) => PostingAvailabilityBlockInput[];
      assertManagedBlob: (blobUrl: string, blobName: string) => void;
      assertCanPublish: (posting: PostingRecord) => void;
      assertPublishableDraftShape: (input: UpsertPostingInput) => void;
      normalizeBatchIds: (ids: string[]) => string[];
    };

    expect(() => service.normalizePhotos([])).toThrow(
      "At least one photo is required.",
    );
    expect(() =>
      service.normalizePhotos(
        Array.from({ length: 11 }, (_, index) => ({
          blobUrl: `https://example.blob.core.windows.net/postings/photo-${index}.jpg`,
          blobName: `postings/photo-${index}.jpg`,
          position: index,
        })),
      ),
    ).toThrow("A posting can include at most");
    expect(() =>
      service.normalizePhotos([
        {
          blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
          blobName: "postings/photo-1.jpg",
          position: 0,
        },
        {
          blobUrl: "https://example.blob.core.windows.net/postings/photo-2.jpg",
          blobName: "postings/photo-2.jpg",
          position: 0,
        },
      ]),
    ).toThrow("Photo positions must be unique.");
    expect(() =>
      service.normalizePhotos([
        {
          blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
          blobName: "postings/photo-1.jpg",
          thumbnailBlobUrl:
            "https://example.blob.core.windows.net/postings/photo-1-thumb.jpg",
          position: 0,
        },
      ]),
    ).toThrow(
      "Thumbnail blob URL and thumbnail blob name must be provided together.",
    );
    expect(() =>
      service.normalizeAvailabilityBlocks([
        {
          startAt: "2026-05-03T00:00:00.000Z",
          endAt: "2026-05-03T00:00:00.000Z",
        },
      ]),
    ).toThrow("Availability block dates must define a valid, non-empty range.");
    expect(() =>
      service.normalizeAvailabilityBlocks([
        {
          startAt: "2026-05-01T00:00:00.000Z",
          endAt: "2026-05-03T00:00:00.000Z",
        },
        {
          startAt: "2026-05-02T00:00:00.000Z",
          endAt: "2026-05-04T00:00:00.000Z",
        },
      ]),
    ).toThrow("Availability blocks may not overlap.");

    Object.assign(service as object, {
      blobService: {
        isConfigured: () => false,
        isManagedBlobUrl: () => true,
      },
    });
    expect(() =>
      service.assertManagedBlob("https://example.test/blob", "blob"),
    ).toThrow("Posting photos require Azure Blob Storage");

    Object.assign(service as object, {
      blobService: {
        isConfigured: () => true,
        isManagedBlobUrl: () => false,
      },
    });
    expect(() =>
      service.assertManagedBlob("https://example.test/blob", "blob"),
    ).toThrow("Posting photo URLs must match");

    const validPosting = buildPostingRecord(createValidInput());
    expect(() =>
      service.assertCanPublish({
        ...validPosting,
        photos: [],
      }),
    ).toThrow("Published postings must include between 1 and 10 photos.");
    expect(() =>
      service.assertCanPublish({
        ...validPosting,
        pricing: {
          ...validPosting.pricing,
          daily: {
            amount: 0,
          },
        },
      }),
    ).toThrow("Published postings must include a valid daily price.");
    expect(() =>
      service.assertCanPublish({
        ...validPosting,
        location: {
          ...validPosting.location,
          latitude: 91,
        },
      }),
    ).toThrow("Published postings must include a valid latitude.");
    expect(() =>
      service.assertCanPublish({
        ...validPosting,
        location: {
          ...validPosting.location,
          longitude: 181,
        },
      }),
    ).toThrow("Published postings must include a valid longitude.");

    const validInput = createValidInput();
    expect(() =>
      service.assertPublishableDraftShape({
        ...validInput,
        name: "   ",
      }),
    ).toThrow("Posting name is required.");
    expect(() =>
      service.assertPublishableDraftShape({
        ...validInput,
        description: "   ",
      }),
    ).toThrow("Posting description is required.");
    expect(() =>
      service.assertPublishableDraftShape({
        ...validInput,
        pricing: {
          ...validInput.pricing,
          daily: {
            amount: 0,
          },
        },
      }),
    ).toThrow("Posting daily pricing is required.");
    expect(() =>
      service.assertPublishableDraftShape({
        ...validInput,
        location: {
          ...validInput.location,
          latitude: -91,
        },
      }),
    ).toThrow("Latitude must be between -90 and 90.");
    expect(() =>
      service.assertPublishableDraftShape({
        ...validInput,
        location: {
          ...validInput.location,
          longitude: 181,
        },
      }),
    ).toThrow("Longitude must be between -180 and 180.");
    expect(() =>
      service.assertPublishableDraftShape({
        ...validInput,
        maxBookingDurationDays: 0,
      }),
    ).toThrow("Maximum booking duration must be an integer between 1 and");

    expect(() => service.normalizeBatchIds([])).toThrow(
      "At least one posting id is required.",
    );
    expect(() =>
      service.normalizeBatchIds(
        Array.from(
          { length: MAX_BATCH_IDS + 1 },
          (_, index) => `posting-${index}`,
        ),
      ),
    ).toThrow("At most");
  });

  it("covers search attribute normalization helpers across supported kinds", async () => {
    const service = createService(new FakePostingsRepository()) as unknown as {
      normalizeSearchAttributeFilters: (
        filters: Array<Record<string, unknown>> | undefined,
        family?: string,
        subtype?: string,
      ) => unknown;
    };

    expect(
      service.normalizeSearchAttributeFilters(
        [
          {
            key: "guest_capacity",
            value: 1,
          },
        ],
        undefined,
        undefined,
      ),
    ).toBeUndefined();
    const invalidVariantError = captureError(() =>
      service.normalizeSearchAttributeFilters(
        [
          {
            key: "guest_capacity",
            value: 1,
          },
        ],
        "place",
        "car",
      ),
    );
    expect(invalidVariantError).toBeInstanceOf(RequestValidationError);
    expect((invalidVariantError as RequestValidationError).details).toEqual([
      {
        path: "attr",
        message: "Attribute filters require a valid family and subtype.",
      },
    ]);
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "property_type",
                value: ["condo"],
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("String attributes support a single exact value only.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "property_type",
                value: true,
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("String attributes require a string value.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "amenities",
                min: 1,
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Array attributes require one or more exact values.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "amenities",
                value: ["wifi", true],
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Array attributes require string values.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "pet_friendly",
                min: 1,
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Boolean attributes support an exact true/false value only.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "pet_friendly",
                value: "maybe",
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Boolean attributes must be true or false.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "guest_capacity",
                value: [1, 2],
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe(
      "Numeric attributes support a single exact value or a min/max range.",
    );
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "guest_capacity",
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Numeric attributes require an exact value or a min/max range.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "guest_capacity",
                min: 5,
                max: 2,
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Attribute minimum cannot exceed attribute maximum.");
    expect(
      (
        captureError(() =>
          service.normalizeSearchAttributeFilters(
            [
              {
                key: "guest_capacity",
                value: "2.5",
              },
            ],
            "place",
            "entire_place",
          ),
        ) as RequestValidationError
      ).details?.[0]?.message,
    ).toBe("Integer attributes must be whole numbers.");

    expect(
      service.normalizeSearchAttributeFilters(
        [
          {
            key: "pet_friendly",
            value: " yes ",
          },
          {
            key: "amenities",
            value: [" WiFi ", "desk", "wifi"],
          },
          {
            key: "guest_capacity",
            min: 2,
            max: "4",
          },
        ],
        "place",
        "entire_place",
      ),
    ).toEqual([
      {
        key: "pet_friendly",
        value: true,
      },
      {
        key: "amenities",
        value: ["wifi", "desk"],
      },
      {
        key: "guest_capacity",
        min: 2,
        max: 4,
      },
    ]);
  });

  it("covers posting detail normalization helpers across supported kinds", async () => {
    const service = createService(new FakePostingsRepository()) as unknown as {
      normalizeSearchableAttributeValue: (
        key: string,
        value: unknown,
        definition: {
          kind: "string" | "number" | "integer" | "boolean" | "stringArray";
          min?: number;
          max?: number;
        },
      ) => unknown;
    };

    expect(
      service.normalizeSearchableAttributeValue("property_type", "  condo  ", {
        kind: "string",
      }),
    ).toBe("condo");
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("property_type", 1, {
            kind: "string",
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.property_type",
        message: "Detail must be a string.",
      },
    ]);

    expect(
      service.normalizeSearchableAttributeValue(
        "amenities",
        [" wifi ", "desk", "wifi"],
        {
          kind: "stringArray",
        },
      ),
    ).toEqual(["wifi", "desk"]);
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("amenities", "wifi", {
            kind: "stringArray",
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.amenities",
        message: "Detail must be an array of strings.",
      },
    ]);

    expect(
      service.normalizeSearchableAttributeValue("furnished", true, {
        kind: "boolean",
      }),
    ).toBe(true);
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("furnished", "yes", {
            kind: "boolean",
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.furnished",
        message: "Detail must be a boolean.",
      },
    ]);

    expect(
      service.normalizeSearchableAttributeValue("guest_capacity", 2, {
        kind: "integer",
        min: 1,
        max: 10,
      }),
    ).toBe(2);
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("guest_capacity", "2", {
            kind: "number",
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.guest_capacity",
        message: "Detail must be a number.",
      },
    ]);
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("guest_capacity", 2.5, {
            kind: "integer",
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.guest_capacity",
        message: "Detail must be an integer.",
      },
    ]);
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("guest_capacity", 0, {
            kind: "integer",
            min: 1,
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.guest_capacity",
        message: "Detail must be at least 1.",
      },
    ]);
    expect(
      getValidationDetails(
        captureError(() =>
          service.normalizeSearchableAttributeValue("guest_capacity", 11, {
            kind: "integer",
            max: 10,
          }),
        ),
      ),
    ).toEqual([
      {
        path: "details.guest_capacity",
        message: "Detail must be at most 10.",
      },
    ]);
  });
});

describe("PostingsService availability calendar", () => {
  function createPublishedRepository(): FakePostingsRepository {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
      archivedAt: undefined,
    };
    return repository;
  }

  it("returns an entry for every day of the requested month", async () => {
    const repository = createPublishedRepository();
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(Object.keys(calendar)).toHaveLength(31);
    expect(calendar["2099-07-01"]).toEqual({
      status: "available",
      validStart: true,
    });
    expect(calendar["2099-07-31"]).toEqual({
      status: "available",
      validStart: true,
    });
  });

  it("marks days covered by an owner availability block as blocked without leaking the private note to the public", async () => {
    const repository = createPublishedRepository();
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-05T00:00:00.000Z"),
        endAt: new Date("2099-07-07T00:00:00.000Z"),
        source: "owner",
        note: "Reserved for family / John Smith",
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    // Anonymous callers must not see the owner's private note.
    expect(calendar["2099-07-05"]).toEqual({
      status: "blocked",
      reason: "blocked",
    });
    expect(calendar["2099-07-06"].status).toBe("blocked");
    // endAt is exclusive: the block ends before July 7 becomes occupied.
    expect(calendar["2099-07-07"].status).toBe("available");
  });

  it("exposes the owner block note to a member viewer", async () => {
    const repository = createPublishedRepository();
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-05T00:00:00.000Z"),
        endAt: new Date("2099-07-06T00:00:00.000Z"),
        source: "owner",
        note: "Reserved for family / John Smith",
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(
      POSTING_1_ID,
      { year: 2099, month: 7 },
      OWNER_1_ID,
    );

    expect(calendar["2099-07-05"]).toEqual({
      status: "blocked",
      reason: "Reserved for family / John Smith",
    });
  });

  it("falls back to a generic reason for a note-less owner block", async () => {
    const repository = createPublishedRepository();
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-08T00:00:00.000Z"),
        endAt: new Date("2099-07-09T00:00:00.000Z"),
        source: "owner",
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-08"]).toEqual({
      status: "blocked",
      reason: "blocked",
    });
  });

  it("marks days covered by a confirmed renting as booked", async () => {
    const repository = createPublishedRepository();
    repository.calendarRentings = [
      {
        startAt: new Date("2099-07-10T00:00:00.000Z"),
        endAt: new Date("2099-07-12T00:00:00.000Z"),
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-10"]).toEqual({
      status: "booked",
      reason: "booked",
    });
    expect(calendar["2099-07-11"].status).toBe("booked");
    expect(calendar["2099-07-12"].status).toBe("available");
  });

  it("ignores stale renting-sourced blocks and relies on the confirmed-renting query", async () => {
    const repository = createPublishedRepository();
    // A `source: "renting"` block lingers after its renting was cancelled, so
    // it is not in the (status-filtered) renting query and must not surface.
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-20T00:00:00.000Z"),
        endAt: new Date("2099-07-21T00:00:00.000Z"),
        source: "renting",
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-20"].status).toBe("available");
  });

  it("marks days under an active booking hold as unavailable", async () => {
    const repository = createPublishedRepository();
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-15T00:00:00.000Z"),
        endAt: new Date("2099-07-16T00:00:00.000Z"),
        source: "booking_hold",
        bookingRequestHold: {
          status: "paid",
          holdExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
        },
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-15"]).toEqual({
      status: "unavailable",
      reason: "held",
    });
  });

  it("marks days under an active booking request as held even without a hold block", async () => {
    const repository = createPublishedRepository();
    // A pending booking request that has not yet materialized a hold block.
    repository.calendarBookingRequests = [
      {
        startAt: new Date("2099-07-22T00:00:00.000Z"),
        endAt: new Date("2099-07-24T00:00:00.000Z"),
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-22"]).toEqual({
      status: "unavailable",
      reason: "held",
    });
    expect(calendar["2099-07-23"].status).toBe("unavailable");
    expect(calendar["2099-07-24"].status).toBe("available");
  });

  it("ignores expired or converted booking holds", async () => {
    const repository = createPublishedRepository();
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-17T00:00:00.000Z"),
        endAt: new Date("2099-07-18T00:00:00.000Z"),
        source: "booking_hold",
        bookingRequestHold: {
          status: "paid",
          holdExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
        },
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-17"].status).toBe("available");
  });

  it("marks every day unavailable when the posting availability status is unavailable", async () => {
    const repository = createPublishedRepository();
    repository.posting = {
      ...repository.posting,
      availabilityStatus: "unavailable",
    };
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    expect(calendar["2099-07-01"]).toEqual({
      status: "unavailable",
      reason: "posting_unavailable",
    });
    expect(
      Object.values(calendar).every(
        (day) =>
          day.status === "unavailable" && day.reason === "posting_unavailable",
      ),
    ).toBe(true);
  });

  it("marks days within the advance-notice window as unavailable", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2099-07-10T12:00:00.000Z"));

    try {
      const repository = createPublishedRepository();
      repository.posting = {
        ...repository.posting,
        advanceNoticeDays: 3,
      };
      const service = createService(repository);

      const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
        year: 2099,
        month: 7,
      });

      expect(calendar["2099-07-12"]).toEqual({
        status: "unavailable",
        reason: "advance_notice",
      });
      expect(calendar["2099-07-13"].status).toBe("available");
    } finally {
      jest.useRealTimers();
    }
  });

  it("marks elapsed days as past even without an advance-notice window", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2099-07-10T12:00:00.000Z"));

    try {
      const repository = createPublishedRepository();
      // advanceNoticeDays is unset, so the notice threshold does not apply and
      // the past cutoff is the only thing keeping elapsed days off the calendar.
      const service = createService(repository);

      const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
        year: 2099,
        month: 7,
      });

      expect(calendar["2099-07-09"]).toEqual({
        status: "unavailable",
        reason: "past",
      });
      // Today itself stays bookable, matching the booking endpoint's cutoff.
      expect(calendar["2099-07-10"].status).toBe("available");
      expect(calendar["2099-07-10"].validStart).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports occupancy ahead of the advance-notice window", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2099-07-10T12:00:00.000Z"));

    try {
      const repository = createPublishedRepository();
      repository.posting = {
        ...repository.posting,
        advanceNoticeDays: 5,
      };
      // July 12 is inside the advance-notice window but is also booked.
      repository.calendarRentings = [
        {
          startAt: new Date("2099-07-12T00:00:00.000Z"),
          endAt: new Date("2099-07-13T00:00:00.000Z"),
        },
      ];
      const service = createService(repository);

      const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
        year: 2099,
        month: 7,
      });

      // The occupied day is reported as booked, not masked as advance_notice.
      expect(calendar["2099-07-12"]).toEqual({
        status: "booked",
        reason: "booked",
      });
      // A free day still inside the window remains advance_notice.
      expect(calendar["2099-07-13"]).toEqual({
        status: "unavailable",
        reason: "advance_notice",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("computes the advance-notice cutoff in UTC to match booking validation", async () => {
    // 01:00Z is still July 9 in America/Toronto (UTC-4). Booking validation
    // uses UTC midnight today (July 10) + 1 day => earliest start July 11 00:00Z.
    jest.useFakeTimers().setSystemTime(new Date("2099-07-10T01:00:00.000Z"));

    try {
      const repository = createPublishedRepository();
      repository.posting = {
        ...repository.posting,
        advanceNoticeDays: 1,
      };
      const service = createService(repository);

      const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
        year: 2099,
        month: 7,
        tz: "America/Toronto",
      });

      // Local July 10 starts at July 10 04:00Z, before the UTC cutoff, so it is
      // within advance notice even though the display timezone is behind UTC.
      expect(calendar["2099-07-10"]).toEqual({
        status: "unavailable",
        reason: "advance_notice",
      });
      expect(calendar["2099-07-11"].status).toBe("available");
    } finally {
      jest.useRealTimers();
    }
  });

  it("flags start dates that cannot satisfy the minimum booking duration", async () => {
    const repository = createPublishedRepository();
    repository.posting = {
      ...repository.posting,
      minBookingDurationDays: 3,
    };
    repository.calendarBlocks = [
      {
        startAt: new Date("2099-07-04T00:00:00.000Z"),
        endAt: new Date("2099-07-05T00:00:00.000Z"),
        source: "owner",
        note: "Owner maintenance",
      },
    ];
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });

    // July 2 is available but a 3-day booking would hit the July 4 block.
    expect(calendar["2099-07-02"]).toEqual({
      status: "available",
      validStart: false,
    });
    // July 5 onward has a clear 3-day window.
    expect(calendar["2099-07-05"]).toEqual({
      status: "available",
      validStart: true,
    });
    // Late-month start dates rely on the look-ahead past month end.
    expect(calendar["2099-07-30"]).toEqual({
      status: "available",
      validStart: true,
    });
  });

  it("resolves day boundaries in the requested timezone", async () => {
    const repository = createPublishedRepository();
    repository.calendarRentings = [
      {
        startAt: new Date("2099-07-01T01:00:00.000Z"),
        endAt: new Date("2099-07-01T02:00:00.000Z"),
      },
    ];
    const service = createService(repository);

    const utcCalendar = await service.getAvailabilityCalendar(POSTING_1_ID, {
      year: 2099,
      month: 7,
    });
    // The renting falls on July 1 in UTC.
    expect(utcCalendar["2099-07-01"].status).toBe("booked");

    const torontoCalendar = await service.getAvailabilityCalendar(
      POSTING_1_ID,
      {
        year: 2099,
        month: 7,
        tz: "America/Toronto",
      },
    );
    // In America/Toronto the same instant is late on June 30, so July 1 is free.
    expect(torontoCalendar["2099-07-01"].status).toBe("available");
  });

  it("throws a bad request error for an unknown timezone", async () => {
    const repository = createPublishedRepository();
    const service = createService(repository);

    await expect(
      service.getAvailabilityCalendar(POSTING_1_ID, {
        year: 2099,
        month: 7,
        tz: "Not/AZone",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns 404 when the posting does not exist", async () => {
    const repository = createPublishedRepository();
    repository.calendarPostingMissing = true;
    const service = createService(repository);

    await expect(
      service.getAvailabilityCalendar(POSTING_1_ID, { year: 2099, month: 7 }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns 404 for a non-published posting viewed anonymously", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await expect(
      service.getAvailabilityCalendar(POSTING_1_ID, { year: 2099, month: 7 }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns 404 for a non-published posting viewed by a non-member", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await expect(
      service.getAvailabilityCalendar(
        POSTING_1_ID,
        { year: 2099, month: 7 },
        OWNER_2_ID,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("lets an owner preview the calendar of their own non-published posting", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    const calendar = await service.getAvailabilityCalendar(
      POSTING_1_ID,
      { year: 2099, month: 7 },
      OWNER_1_ID,
    );

    expect(Object.keys(calendar)).toHaveLength(31);
  });
});

describe("PostingsService posting expiry", () => {
  const DAY_IN_MS = 24 * 60 * 60 * 1000;

  function endOfUtcDay(offsetDays: number): string {
    const date = new Date(Date.now() + offsetDays * DAY_IN_MS);

    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    ).toISOString();
  }

  const FUTURE = endOfUtcDay(30);
  // "Past" now means a day that has already ended, not merely an instant
  // before now: inputs are snapped to their UTC day boundary before the future
  // check, so an instant from earlier today is still a live deadline.
  const PAST = endOfUtcDay(-2);

  it("accepts a future expiry date on create", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await service.createDraft(OWNER_1_ID, {
      ...createValidInput(),
      expiresAt: FUTURE,
    });

    expect(repository.lastCreateInput?.expiresAt).toBe(FUTURE);
  });

  it("accepts an omitted expiry date, meaning the listing never expires", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await service.createDraft(OWNER_1_ID, createValidInput());

    expect(repository.createCalls).toBe(1);
  });

  it("rejects an expiry date in the past on create", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await expect(
      service.createDraft(OWNER_1_ID, {
        ...createValidInput(),
        expiresAt: PAST,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.createCalls).toBe(0);
  });

  it("rejects an expiry date beyond the supported horizon", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const farFuture = new Date(
      Date.now() + 800 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await expect(
      service.createDraft(OWNER_1_ID, {
        ...createValidInput(),
        expiresAt: farFuture,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects an unparseable expiry date", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await expect(
      service.createDraft(OWNER_1_ID, {
        ...createValidInput(),
        expiresAt: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("refuses to publish a draft whose expiry date has already passed", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "draft",
      expiresAt: PAST,
    };
    const service = createService(repository);

    await expect(
      service.publish(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.publishCalls).toBe(0);
  });

  it("publishes a draft whose expiry date is still ahead", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "draft",
      expiresAt: FUTURE,
    };
    const service = createService(repository);

    const published = await service.publish(POSTING_1_ID, OWNER_1_ID);

    expect(published.status).toBe("published");
  });

  it("refuses to unpause a posting whose expiry date has passed", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "paused",
      expiresAt: PAST,
    };
    const service = createService(repository);

    // Allowing this would let the sweeper re-pause it within one poll.
    await expect(
      service.unpause(POSTING_1_ID, OWNER_1_ID),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.unpauseCalls).toBe(0);
  });

  it("unpauses once the owner has moved the expiry date forward", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "paused",
      expiresAt: FUTURE,
    };
    const service = createService(repository);

    const unpaused = await service.unpause(POSTING_1_ID, OWNER_1_ID);

    expect(unpaused.status).toBe("published");
  });

  it("unpauses a posting that has no expiry date at all", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      status: "paused",
      expiresAt: undefined,
    };
    const service = createService(repository);

    await expect(
      service.unpause(POSTING_1_ID, OWNER_1_ID),
    ).resolves.toMatchObject({
      status: "published",
    });
  });

  it("snaps an API-supplied expiry to the end of its UTC day", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const midday = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    midday.setUTCHours(12, 30, 0, 0);

    await service.createDraft(OWNER_1_ID, {
      ...createValidInput(),
      expiresAt: midday.toISOString(),
    });

    // Storing an unsnapped instant would reintroduce drift: the wizard reduces
    // it to a date on open, then the next save expands it back to end-of-day.
    const expected = new Date(
      Date.UTC(
        midday.getUTCFullYear(),
        midday.getUTCMonth(),
        midday.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    ).toISOString();
    expect(repository.lastCreateInput?.expiresAt).toBe(expected);
  });

  it("accepts an instant earlier today because its day has not ended", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const earlierToday = new Date();
    earlierToday.setUTCHours(0, 0, 1, 0);

    // Normalizing before the future check is deliberate: the client means
    // "expire at the end of this day", which is still ahead.
    await service.createDraft(OWNER_1_ID, {
      ...createValidInput(),
      expiresAt: earlierToday.toISOString(),
    });

    expect(repository.createCalls).toBe(1);
  });

  it("still rejects an instant on a day that has fully passed", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    await expect(
      service.createDraft(OWNER_1_ID, {
        ...createValidInput(),
        expiresAt: lastWeek.toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("does not carry an expiry date onto a duplicate", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      expiresAt: PAST,
    };
    const service = createService(repository);

    await service.duplicate(POSTING_1_ID, OWNER_1_ID);

    // A past date would otherwise make the fresh draft unpublishable on arrival.
    expect(repository.lastCreateInput?.expiresAt).toBeNull();
  });

  it("carries instant booking onto a duplicate", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: POSTING_1_ID,
      instantBooking: true,
    };
    const service = createService(repository);

    await service.duplicate(POSTING_1_ID, OWNER_1_ID);

    expect(repository.lastCreateInput?.instantBooking).toBe(true);
  });
});
