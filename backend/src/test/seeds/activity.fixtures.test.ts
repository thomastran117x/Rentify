import {
  SEED_ANALYTICS_OUTBOX_EVENTS,
  SEED_POSTING_REVIEWS,
  SEED_SAVED_SEARCHES,
} from "@/seeds/fixtures/activity";
import {
  hashSavedSearchParams,
  savedSearchQueryParamsSchema,
} from "@/features/postings/saved-searches/saved-searches.model";
import { SEED_USERS } from "@/seeds/fixtures/users";

describe("seeded analytics outbox fixtures", () => {
  it("provides worker-compatible payloads and does not leave pending analytics jobs", () => {
    for (const event of SEED_ANALYTICS_OUTBOX_EVENTS) {
      expect(event.processedAt).toBeDefined();

      if (event.eventType === "posting_viewed") {
        expect(event.payload.occurredAt).toBeDefined();
        expect(event.payload.viewerHash).toBeDefined();
        expect(event.payload.deviceType).toBeDefined();
      }

      if (
        event.eventType === "booking_requested" ||
        event.eventType === "renting_confirmed"
      ) {
        expect(event.payload.occurredAt).toBeDefined();
        expect(event.payload.estimatedTotal).toBeDefined();
      }
    }
  });

  it("keeps reviews concentrated on seventeen postings with seeded reviewers", () => {
    const reviewedPostingIds = new Set(
      SEED_POSTING_REVIEWS.map((review) => review.postingId),
    );
    const reviewsPerPosting = new Map<string, number>();
    const reviewerEmails = new Set(SEED_USERS.map((user) => user.email));

    for (const review of SEED_POSTING_REVIEWS) {
      reviewsPerPosting.set(
        review.postingId,
        (reviewsPerPosting.get(review.postingId) ?? 0) + 1,
      );
      expect(reviewerEmails.has(review.reviewerEmail)).toBe(true);
    }

    expect(reviewedPostingIds.size).toBe(17);

    for (const count of reviewsPerPosting.values()) {
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("seeded saved search fixtures", () => {
  it("stores filters the live search contract still accepts", () => {
    for (const search of SEED_SAVED_SEARCHES) {
      expect(
        savedSearchQueryParamsSchema.safeParse(search.queryParams).success,
      ).toBe(true);
    }
  });

  it("attaches every search to a seeded user", () => {
    const seededEmails = new Set(SEED_USERS.map((user) => user.email));

    for (const search of SEED_SAVED_SEARCHES) {
      expect(seededEmails.has(search.userEmail)).toBe(true);
    }
  });

  it("keeps identifiers and per-user filter sets unique", () => {
    const ids = SEED_SAVED_SEARCHES.map((search) => search.id);
    const hashes = SEED_SAVED_SEARCHES.map(
      (search) =>
        `${search.userEmail}:${hashSavedSearchParams(
          savedSearchQueryParamsSchema.parse(search.queryParams),
        )}`,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("keeps a search that matches nothing, which is the case the feature exists for", () => {
    expect(
      SEED_SAVED_SEARCHES.some((search) => search.name.includes("Lighthouse")),
    ).toBe(true);
  });
});
