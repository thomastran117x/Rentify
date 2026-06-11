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
import type { AuthRepository } from "@/features/auth/auth.repository";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

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
    buildAvailabilityBlockRecord("block-1", {
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
    if (input.excludeBlockId === "block-1") {
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
      "owner-1",
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
      "manager-1",
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
      "operator-1",
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
      "owner-2",
      [
        {
          membershipId: "membership-4",
          organizationId: "org-2",
          organizationName: "Org 2",
          role: "primary_manager" as const,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    ],
  ]);
  preferredOrganizationIdByUserId = new Map<string, string>([
    ["owner-1", "org-1"],
    ["manager-1", "org-1"],
    ["operator-1", "org-1"],
    ["owner-2", "org-2"],
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

function createServiceHarness(
  repository: FakePostingsRepository,
  postingsReviewsRepository = new FakePostingsReviewsRepository(),
  rentingsRepository = new FakeRentingsRepository(),
  searchService = {} as PostingsPublicSearchService,
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
    authRepository as unknown as AuthRepository,
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
      authRepository as unknown as AuthRepository,
    ),
    postingThumbnailQueueService,
    postingsPublicCacheService,
    organizationAccessService,
    authRepository,
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
    id: "posting-1",
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
      .createDraft("owner-1", input)
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
      .createDraft("owner-1", input)
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
      organizationId: "org-2",
    };

    const created = await service.createDraft("manager-1", input);

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
      service.createDraft("operator-1", input),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createCalls).toBe(0);
  });

  it("lists postings for the caller's active organization", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);

    await service.listByOwner("manager-1", {
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

  it("rejects unsafe content before update persists", async () => {
    const repository = new FakePostingsRepository();
    const service = createService(repository);
    const input = createValidInput();
    input.tags = ["safe", "' OR 1=1 --"];

    const error = await service
      .update("posting-123", "owner-1", input)
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

    const created = await service.createDraft("owner-1", input);

    expect(repository.createCalls).toBe(1);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith("posting-1");
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      "posting-1",
    ]);
    expect(created.tags).toEqual(["loft", "transit"]);
  });

  it("duplicates an owner posting into a new draft with owner-authored availability and copied photos", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-source",
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

    const duplicated = await service.duplicate("posting-source", "owner-1");

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
    expect(duplicated.id).toBe("posting-1");
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
      organizationId: "org-2",
    };
    const service = createService(repository);

    await expect(
      service.duplicate("posting-1", "owner-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.createCalls).toBe(0);
  });

  it("pauses a published posting while preserving its published timestamp", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const paused = await service.pause("posting-1", "owner-1");

    expect(paused.status).toBe("paused");
    expect(paused.publishedAt).toBe("2026-04-21T00:00:00.000Z");
    expect(paused.pausedAt).toBeDefined();
    expect(repository.pauseCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      "posting-1",
    ]);
  });

  it("unpauses a paused posting without changing its original published timestamp", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "paused",
      publishedAt: "2026-04-21T00:00:00.000Z",
      pausedAt: "2026-04-23T00:00:00.000Z",
    };
    const {
      service,
      postingThumbnailQueueService,
      postingsPublicCacheService,
    } = createServiceHarness(repository);

    const unpaused = await service.unpause("posting-1", "owner-1");

    expect(unpaused.status).toBe("published");
    expect(unpaused.publishedAt).toBe("2026-04-21T00:00:00.000Z");
    expect(unpaused.pausedAt).toBeUndefined();
    expect(repository.unpauseCalls).toBe(1);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith("posting-1");
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      "posting-1",
    ]);
  });

  it("publishes a draft posting and enqueues thumbnail generation", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "draft",
    };
    const {
      service,
      postingThumbnailQueueService,
      postingsPublicCacheService,
    } = createServiceHarness(repository);

    const published = await service.publish("posting-1", "owner-1");

    expect(published.status).toBe("published");
    expect(repository.publishCalls).toBe(1);
    expect(
      postingThumbnailQueueService.enqueuePostingThumbnailJob,
    ).toHaveBeenCalledWith("posting-1");
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      "posting-1",
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
      service.publish("posting-1", "owner-1"),
    ).rejects.toBeInstanceOf(BadRequestError);

    repository.posting = {
      ...repository.posting,
      status: "draft",
    };
    await expect(service.pause("posting-1", "owner-1")).rejects.toBeInstanceOf(
      BadRequestError,
    );

    repository.posting = {
      ...repository.posting,
      status: "published",
    };
    await expect(
      service.unpause("posting-1", "owner-1"),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("hides paused postings from public getById while still allowing owners to view them", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "paused",
      publishedAt: "2026-04-21T00:00:00.000Z",
      pausedAt: "2026-04-23T00:00:00.000Z",
    };
    const service = createService(repository);

    await expect(
      service.getById("posting-1", "renter-1"),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    const ownerView = await service.getById("posting-1", "owner-1");
    expect(ownerView.status).toBe("paused");
  });

  it("bypasses the public cache for owner getById reads", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "draft",
    };
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);
    postingsPublicCacheService.posting = null;

    const posting = await service.getById("posting-1", "owner-1");

    expect(posting.status).toBe("draft");
    expect(repository.findByIdCalls).toBe(1);
  });

  it("uses the cached public projection for anonymous getById reads", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);
    postingsPublicCacheService.posting = {
      ...toPublicPostingRecord(repository.posting),
      name: "Cached name",
    };

    const posting = await service.getById("posting-1");

    expect(posting).toMatchObject({
      id: "posting-1",
      name: "Cached name",
    });
    expect(repository.findByIdCalls).toBe(0);
  });

  it("includes viewer review state for an eligible renter on public getById", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
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

    const posting = await service.getById("posting-1", "renter-1");

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
      id: "posting-1",
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const service = createService(repository);

    const posting = await service.getById("posting-1");

    expect("viewerReviewState" in posting).toBe(false);
  });

  it("includes viewer review state for an ineligible renter on public getById", async () => {
    const repository = new FakePostingsRepository();
    repository.posting = {
      ...repository.posting,
      id: "posting-1",
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    const service = createService(repository);

    const posting = await service.getById("posting-1", "renter-1");

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
      .createDraft("owner-1", input)
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
      .createDraft("owner-1", input)
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
      .createDraft("owner-1", input)
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

    const created = await service.createDraft("owner-1", input);

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
      "posting-1",
      "owner-1",
    );

    expect(result.availabilityBlocks).toEqual(repository.ownerBlocks);
    expect(repository.findByIdCalls).toBe(1);
  });

  it("creates an owner availability block after validating conflicts", async () => {
    const repository = new FakePostingsRepository();
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const created = await service.createOwnerAvailabilityBlock(
      "posting-1",
      "owner-1",
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
      "posting-1",
    ]);
  });

  it("rejects owner availability blocks that overlap another owner block", async () => {
    const repository = new FakePostingsRepository();
    repository.ownerOverlap = true;
    const service = createService(repository);

    const error = await service
      .createOwnerAvailabilityBlock("posting-1", "owner-1", {
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
      .createOwnerAvailabilityBlock("posting-1", "owner-1", {
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
      .createOwnerAvailabilityBlock("posting-1", "owner-1", {
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
      "posting-1",
      "owner-1",
      "block-1",
      {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
      },
    );

    expect(updated.id).toBe("block-1");
    expect(repository.updateOwnerAvailabilityBlockCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      "posting-1",
    ]);
  });

  it("does not update or delete non-owner availability blocks", async () => {
    const repository = new FakePostingsRepository();
    repository.blockLookup = null;
    repository.deleteResult = false;
    const service = createService(repository);

    await expect(
      service.updateOwnerAvailabilityBlock(
        "posting-1",
        "owner-1",
        "booking-hold-1",
        {
          startAt: "2026-05-01T00:00:00.000Z",
          endAt: "2026-05-04T00:00:00.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    await expect(
      service.deleteOwnerAvailabilityBlock(
        "posting-1",
        "owner-1",
        "booking-hold-1",
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
      authRepository as unknown as AuthRepository,
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
      authRepository as unknown as AuthRepository,
    );

    await expect(
      service.createOwnerAvailabilityBlock("posting-1", "owner-1", {
        startAt: "2026-06-01T00:00:00.000Z",
        endAt: "2026-06-03T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("archives managed postings and invalidates the public projection", async () => {
    const repository = new FakePostingsRepository();
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);

    const archived = await service.archive("posting-1", "owner-1");

    expect(archived.status).toBe("archived");
    expect(repository.archiveCalls).toBe(1);
    expect(postingsPublicCacheService.invalidatedPostingIds).toEqual([
      "posting-1",
    ]);
  });

  it("rejects archive when the repository no longer returns the posting", async () => {
    const repository = new FakePostingsRepository();
    repository.archive = jest.fn(async () => null) as never;
    const service = createService(repository);

    await expect(
      service.archive("posting-1", "owner-1"),
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

    const result = await service.batchByOwner("owner-1", [
      " posting-1 ",
      "posting-1",
      "posting-3",
    ]);

    expect(repository.batchFindByOwner).toHaveBeenCalledWith({
      organizationId: "org-1",
      ids: ["posting-1", "posting-3"],
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
      " posting-1 ",
      "posting-1",
      "posting-missing",
    ]);

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.id).toBe("posting-1");
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
    authRepository.membershipsByUserId.set("memberless-1", []);
    authRepository.preferredOrganizationIdByUserId.set("memberless-1", "org-1");

    await expect(
      service.listByOwner("memberless-1", {
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects owner reads when the user record cannot be found", async () => {
    const repository = new FakePostingsRepository();
    const { service, authRepository } = createServiceHarness(repository);
    authRepository.membershipsByUserId.delete("ghost-user");
    authRepository.preferredOrganizationIdByUserId.delete("ghost-user");

    await expect(
      service.listByOwner("ghost-user", {
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns not found when public-read metadata is missing for an authenticated viewer", async () => {
    const repository = new FakePostingsRepository();
    repository.findPublicReadMetadataById = jest.fn(async () => null) as never;
    const service = createService(repository);

    await expect(
      service.getById("posting-1", "owner-1"),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns not found when an owner viewer can see metadata but the posting row disappears", async () => {
    const repository = new FakePostingsRepository();
    repository.findById = jest.fn(async () => null) as never;
    const service = createService(repository);

    await expect(
      service.getById("posting-1", "owner-1"),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("returns not found when no public projection exists for anonymous reads", async () => {
    const repository = new FakePostingsRepository();
    const { service, postingsPublicCacheService } =
      createServiceHarness(repository);
    postingsPublicCacheService.posting = null;

    await expect(service.getById("posting-1")).rejects.toBeInstanceOf(
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
      authRepository as unknown as AuthRepository,
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
      authRepository as unknown as AuthRepository,
    );

    await expect(
      service.createDraft("owner-1", createValidInput()),
    ).resolves.toMatchObject({
      id: "posting-1",
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
          min: "2",
          max: "5",
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
    updateRepository.update = jest.fn(async () => null) as never;
    const updateService = createService(updateRepository);

    await expect(
      updateService.update("posting-1", "owner-1", createValidInput()),
    ).rejects.toThrow("Posting could not be found.");

    const blockRepository = new FakePostingsRepository();
    blockRepository.updateOwnerAvailabilityBlock = jest.fn(
      async () => null,
    ) as never;
    const blockService = createService(blockRepository);

    await expect(
      blockService.updateOwnerAvailabilityBlock(
        "posting-1",
        "owner-1",
        "block-1",
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
        "posting-1",
        "owner-1",
        "block-1",
      ),
    ).rejects.toThrow("Availability block could not be found.");

    const publishRepository = new FakePostingsRepository();
    publishRepository.publish = jest.fn(async () => null) as never;
    const publishService = createService(publishRepository);

    await expect(
      publishService.publish("posting-1", "owner-1"),
    ).rejects.toThrow("Posting could not be found.");

    const pauseRepository = new FakePostingsRepository();
    pauseRepository.posting = {
      ...pauseRepository.posting,
      status: "published",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    pauseRepository.pause = jest.fn(async () => null) as never;
    const pauseService = createService(pauseRepository);

    await expect(pauseService.pause("posting-1", "owner-1")).rejects.toThrow(
      "Posting could not be found.",
    );

    const unpauseRepository = new FakePostingsRepository();
    unpauseRepository.posting = {
      ...unpauseRepository.posting,
      status: "paused",
      pausedAt: "2026-04-23T00:00:00.000Z",
      publishedAt: "2026-04-21T00:00:00.000Z",
    };
    unpauseRepository.unpause = jest.fn(async () => null) as never;
    const unpauseService = createService(unpauseRepository);

    await expect(
      unpauseService.unpause("posting-1", "owner-1"),
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
            min: "2",
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
