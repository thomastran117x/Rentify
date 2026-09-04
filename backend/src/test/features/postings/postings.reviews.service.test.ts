import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ConflictError from "@/errors/http/conflict.error";
import { PostingsReviewsService } from "@/features/postings/reviews/reviews.service";
import type {
  CreatePostingReviewRequestBody,
  PostingReviewRecord,
} from "@/features/postings/reviews/reviews.model";
import type { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { testUuid } from "../../support/uuid";
const OWNER_1_ID = testUuid(9000, 219201);
const POSTING_1_ID = testUuid(9000, 254272);
const RENTER_1_ID = testUuid(9000, 235000);

const REVIEW_1_ID = testUuid(9000, 118005);

class FakePostingsRepository {
  posting = {
    id: POSTING_1_ID,
    organizationId: "org-1",
    status: "published",
    archivedAt: undefined,
  };

  async findById(id: string) {
    return {
      ...this.posting,
      id,
    };
  }

  async enqueueSearchSync(_postingId: string): Promise<void> {}
}

class FakePostingsReviewsRepository {
  ownReview: PostingReviewRecord | null = null;
  createdReview: PostingReviewRecord = buildReviewRecord();
  lastCreateInput: unknown = null;

  async findOwnReview(): Promise<PostingReviewRecord | null> {
    return this.ownReview;
  }

  async create(input: unknown): Promise<PostingReviewRecord> {
    this.lastCreateInput = input;
    return this.createdReview;
  }

  async updateOwnReview(): Promise<PostingReviewRecord | null> {
    return this.ownReview;
  }

  async updatePostingRatingStats(): Promise<void> {
    // no-op in tests
  }

  async listByPosting() {
    return {
      reviews: [],
      summary: {
        averageRating: 0,
        reviewCount: 0,
      },
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }
}

class FakeRentingsRepository {
  eligible = false;

  async hasEligibleReviewRenting(): Promise<boolean> {
    return this.eligible;
  }
}

class FakeOrganizationAccessService {
  memberships = new Map<string, string>([[OWNER_1_ID, "org-1"]]);

  async findMembership(userId: string, organizationId: string) {
    return this.memberships.get(userId) === organizationId
      ? {
          organizationId,
          userId,
          role: "primary_manager" as const,
        }
      : null;
  }
}

function createService(options?: {
  postingsRepository?: FakePostingsRepository;
  postingsReviewsRepository?: FakePostingsReviewsRepository;
  rentingsRepository?: FakeRentingsRepository;
  organizationAccessService?: FakeOrganizationAccessService;
}) {
  const postingsRepository =
    options?.postingsRepository ?? new FakePostingsRepository();
  const postingsReviewsRepository =
    options?.postingsReviewsRepository ?? new FakePostingsReviewsRepository();
  const rentingsRepository =
    options?.rentingsRepository ?? new FakeRentingsRepository();
  const organizationAccessService =
    options?.organizationAccessService ?? new FakeOrganizationAccessService();

  const postingsPublicCacheService = {
    invalidatePublic: jest.fn(async () => undefined),
  };

  return new PostingsReviewsService(
    postingsReviewsRepository as unknown as PostingsReviewsRepository,
    postingsRepository as unknown as PostingsRepository,
    rentingsRepository as unknown as RentingsRepository,
    organizationAccessService as unknown as OrganizationAccessService,
    postingsPublicCacheService as unknown as import("@/features/postings/postings.public-cache.service").PostingsPublicCacheService,
  );
}

function buildReviewRequestBody(): CreatePostingReviewRequestBody {
  return {
    rating: 5,
    title: "Excellent stay",
    comment: "Everything matched the listing.",
  };
}

function buildReviewRecord(): PostingReviewRecord {
  return {
    id: REVIEW_1_ID,
    postingId: POSTING_1_ID,
    reviewerId: RENTER_1_ID,
    rating: 5,
    title: "Excellent stay",
    comment: "Everything matched the listing.",
    reviewer: {},
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

describe("PostingsReviewsService", () => {
  it("prevents owners from reviewing their own postings", async () => {
    const service = createService();

    await expect(
      service.create(POSTING_1_ID, OWNER_1_ID, buildReviewRequestBody()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects renters without a completed eligible renting", async () => {
    const service = createService();

    await expect(
      service.create(POSTING_1_ID, RENTER_1_ID, buildReviewRequestBody()),
    ).rejects.toMatchObject<Partial<ForbiddenError>>({
      message: "You can only review postings you have completed a rental for.",
    });
  });

  it("allows creating a review after a completed eligible renting", async () => {
    const postingsReviewsRepository = new FakePostingsReviewsRepository();
    const rentingsRepository = new FakeRentingsRepository();
    rentingsRepository.eligible = true;
    const service = createService({
      postingsReviewsRepository,
      rentingsRepository,
    });

    const review = await service.create(
      POSTING_1_ID,
      RENTER_1_ID,
      buildReviewRequestBody(),
    );

    expect(review.id).toBe(REVIEW_1_ID);
  });

  it("trims blank review title and comment fields to null", async () => {
    const postingsReviewsRepository = new FakePostingsReviewsRepository();
    const rentingsRepository = new FakeRentingsRepository();
    rentingsRepository.eligible = true;
    const service = createService({
      postingsReviewsRepository,
      rentingsRepository,
    });

    await service.create(POSTING_1_ID, RENTER_1_ID, {
      rating: 4,
      title: "   ",
      comment: "   ",
    });

    expect(postingsReviewsRepository.lastCreateInput).toEqual(
      expect.objectContaining({
        title: null,
        comment: null,
      }),
    );
  });

  it("still enforces one review per reviewer per posting", async () => {
    const postingsReviewsRepository = new FakePostingsReviewsRepository();
    postingsReviewsRepository.ownReview = buildReviewRecord();
    const rentingsRepository = new FakeRentingsRepository();
    rentingsRepository.eligible = true;
    const service = createService({
      postingsReviewsRepository,
      rentingsRepository,
    });

    await expect(
      service.create(POSTING_1_ID, RENTER_1_ID, buildReviewRequestBody()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows updating an existing review after a completed eligible renting", async () => {
    const postingsReviewsRepository = new FakePostingsReviewsRepository();
    postingsReviewsRepository.ownReview = buildReviewRecord();
    const rentingsRepository = new FakeRentingsRepository();
    rentingsRepository.eligible = true;
    const service = createService({
      postingsReviewsRepository,
      rentingsRepository,
    });

    const review = await service.updateOwn(
      POSTING_1_ID,
      RENTER_1_ID,
      buildReviewRequestBody(),
    );

    expect(review.id).toBe(REVIEW_1_ID);
  });

  it("returns not found when updating a review that does not exist", async () => {
    const rentingsRepository = new FakeRentingsRepository();
    rentingsRepository.eligible = true;
    const service = createService({
      rentingsRepository,
    });

    await expect(
      service.updateOwn(POSTING_1_ID, RENTER_1_ID, buildReviewRequestBody()),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  describe("getOwn", () => {
    it("reports eligibility with no existing review", async () => {
      const rentingsRepository = new FakeRentingsRepository();
      rentingsRepository.eligible = true;
      const service = createService({ rentingsRepository });

      await expect(service.getOwn(POSTING_1_ID, RENTER_1_ID)).resolves.toEqual({
        eligible: true,
        review: null,
      });
    });

    it("returns the caller's existing review so the form can prefill", async () => {
      const postingsReviewsRepository = new FakePostingsReviewsRepository();
      postingsReviewsRepository.ownReview = buildReviewRecord();
      const rentingsRepository = new FakeRentingsRepository();
      rentingsRepository.eligible = true;
      const service = createService({
        postingsReviewsRepository,
        rentingsRepository,
      });

      await expect(service.getOwn(POSTING_1_ID, RENTER_1_ID)).resolves.toEqual({
        eligible: true,
        review: buildReviewRecord(),
      });
    });

    it("reports ineligible without a completed eligible renting", async () => {
      const service = createService();

      await expect(service.getOwn(POSTING_1_ID, RENTER_1_ID)).resolves.toEqual({
        eligible: false,
        review: null,
      });
    });

    it("reports ineligible for members of the owning organization", async () => {
      const rentingsRepository = new FakeRentingsRepository();
      rentingsRepository.eligible = true;
      const service = createService({ rentingsRepository });

      await expect(service.getOwn(POSTING_1_ID, OWNER_1_ID)).resolves.toEqual({
        eligible: false,
        review: null,
      });
    });

    it("returns not found for postings that are not publicly visible", async () => {
      const postingsRepository = new FakePostingsRepository();
      postingsRepository.posting = {
        ...postingsRepository.posting,
        status: "paused",
      };
      const service = createService({ postingsRepository });

      await expect(
        service.getOwn(POSTING_1_ID, RENTER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  it("lists reviews only for published postings", async () => {
    const postingsRepository = new FakePostingsRepository();
    postingsRepository.posting = {
      ...postingsRepository.posting,
      status: "paused",
    };
    const service = createService({
      postingsRepository,
    });

    await expect(service.list(POSTING_1_ID, 1, 20)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("lists reviews for published postings", async () => {
    const postingsReviewsRepository = new FakePostingsReviewsRepository();
    const service = createService({
      postingsReviewsRepository,
    });

    const result = await service.list(POSTING_1_ID, 2, 10);

    expect(result).toEqual({
      reviews: [],
      summary: {
        averageRating: 0,
        reviewCount: 0,
      },
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });
});
