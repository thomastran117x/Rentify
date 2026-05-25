import {
  SEED_ANALYTICS_OUTBOX_EVENTS,
  SEED_POSTING_REVIEWS,
} from "@/seeds/fixtures/activity";
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

  it("keeps reviews concentrated on five postings with seeded reviewers", () => {
    const reviewedPostingIds = new Set(
      SEED_POSTING_REVIEWS.map((review) => review.postingId),
    );
    const reviewsPerPosting = new Map<number, number>();
    const reviewerEmails = new Set(SEED_USERS.map((user) => user.email));

    for (const review of SEED_POSTING_REVIEWS) {
      reviewsPerPosting.set(
        review.postingId,
        (reviewsPerPosting.get(review.postingId) ?? 0) + 1,
      );
      expect(reviewerEmails.has(review.reviewerEmail)).toBe(true);
    }

    expect(reviewedPostingIds.size).toBe(5);

    for (const count of reviewsPerPosting.values()) {
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });
});
