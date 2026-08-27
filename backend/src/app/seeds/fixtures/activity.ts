import {
  EXPANDED_SEED_ORGANIZATIONS,
  getExpandedPostingId,
} from "@/seeds/fixtures/posting-expansion";
import {
  createFixtureId,
  type SeedOrganizationReviewFixture,
  type SeedPostingAnalyticsOutboxFixture,
  type SeedPostingReviewFixture,
  type SeedPostingViewEventFixture,
  type SeedSavedPostingFixture,
  type SeedSavedSearchFixture,
} from "@/seeds/types";

const BASE_SEED_POSTING_REVIEWS: SeedPostingReviewFixture[] = [
  {
    id: createFixtureId(4000, 1),
    postingId: createFixtureId(2000, 1),
    reviewerEmail: "user1@rentify.local",
    rating: 5,
    title: "Bright and easy to use",
    comment: "Great light, clean space, and an easy handoff.",
    createdAt: "2026-04-12T18:00:00.000Z",
  },
  {
    id: createFixtureId(4000, 2),
    postingId: createFixtureId(2000, 1),
    reviewerEmail: "user2@rentify.local",
    rating: 4,
    title: "Reliable downtown setup",
    comment:
      "Fast pickup, bright natural light, and everything matched the listing.",
    createdAt: "2026-04-13T18:00:00.000Z",
  },
  {
    id: createFixtureId(4000, 3),
    postingId: createFixtureId(2000, 11),
    reviewerEmail: "user3@rentify.local",
    rating: 4,
    title: "Solid workshop setup",
    comment:
      "Worked well for a team review session with plenty of room to spread out.",
    createdAt: "2026-04-14T16:30:00.000Z",
  },
  {
    id: createFixtureId(4000, 4),
    postingId: createFixtureId(2000, 11),
    reviewerEmail: "user4@rentify.local",
    rating: 5,
    title: "Easy for collaborative sessions",
    comment:
      "The host was organized and the layout made team workshops feel effortless.",
    createdAt: "2026-04-15T19:15:00.000Z",
  },
  {
    id: createFixtureId(4000, 5),
    postingId: createFixtureId(2000, 16),
    reviewerEmail: "user1@rentify.local",
    rating: 5,
    title: "Quiet and photogenic",
    comment:
      "The canal view is even better in person and the space photographed beautifully.",
    createdAt: "2026-04-16T20:10:00.000Z",
  },
  {
    id: createFixtureId(4000, 6),
    postingId: createFixtureId(2000, 16),
    reviewerEmail: "user2@rentify.local",
    rating: 5,
    title: "Perfect for a polished client stay",
    comment:
      "Quiet at night, easy check-in, and the details felt premium without being fussy.",
    createdAt: "2026-04-17T20:10:00.000Z",
  },
  {
    id: createFixtureId(4000, 7),
    postingId: createFixtureId(2000, 21),
    reviewerEmail: "user3@rentify.local",
    rating: 5,
    title: "Flexible for production",
    comment:
      "The loft handled a client walkthrough really well and gave us space for quick staging changes.",
    createdAt: "2026-04-18T20:10:00.000Z",
  },
  {
    id: createFixtureId(4000, 8),
    postingId: createFixtureId(2000, 21),
    reviewerEmail: "user4@rentify.local",
    rating: 4,
    title: "Comfortable creative base",
    comment:
      "Good natural light and a layout that works for small shoots without feeling cramped.",
    createdAt: "2026-04-19T20:10:00.000Z",
  },
  {
    id: createFixtureId(4000, 9),
    postingId: createFixtureId(2000, 29),
    reviewerEmail: "user5@rentify.local",
    rating: 5,
    title: "Styled beautifully",
    comment:
      "Excellent for editorial stills and a short stay, with thoughtful details throughout.",
    createdAt: "2026-04-20T20:10:00.000Z",
  },
  {
    id: createFixtureId(4000, 10),
    postingId: createFixtureId(2000, 29),
    reviewerEmail: "user6@rentify.local",
    rating: 4,
    title: "Strong for content teams",
    comment:
      "The rooms had enough separation for wardrobe, talent, and gear without stepping on each other.",
    createdAt: "2026-04-21T20:10:00.000Z",
  },
  {
    id: createFixtureId(4000, 11),
    postingId: createFixtureId(2000, 29),
    reviewerEmail: "user7@rentify.local",
    rating: 5,
    title: "Would book again",
    comment:
      "Beautifully maintained, simple check-in, and the host communicated clearly the whole time.",
    createdAt: "2026-04-22T18:40:00.000Z",
  },
  {
    id: createFixtureId(4000, 12),
    postingId: createFixtureId(2000, 16),
    reviewerEmail: "user8@rentify.local",
    rating: 4,
    title: "Calm and dependable",
    comment:
      "A very easy stay for a review trip, with great transit access and a polished interior.",
    createdAt: "2026-04-21T20:10:00.000Z",
  },
];

const BASE_SEED_POSTING_VIEW_EVENTS: SeedPostingViewEventFixture[] = [
  {
    id: createFixtureId(4010, 1),
    postingId: createFixtureId(2000, 1),
    viewerHash: "viewer-hash-1",
    userEmail: "viewer1@rentify.local",
    ipAddressHash: "ip-hash-1",
    userAgentHash: "ua-hash-1",
    deviceType: "desktop",
    occurredAt: "2026-04-20T09:00:00.000Z",
  },
  {
    id: createFixtureId(4010, 2),
    postingId: createFixtureId(2000, 1),
    viewerHash: "viewer-hash-2",
    userEmail: "user1@rentify.local",
    ipAddressHash: "ip-hash-2",
    userAgentHash: "ua-hash-2",
    deviceType: "mobile",
    occurredAt: "2026-04-20T12:00:00.000Z",
  },
  {
    id: createFixtureId(4010, 3),
    postingId: createFixtureId(2000, 11),
    viewerHash: "viewer-hash-3",
    userEmail: "user2@rentify.local",
    ipAddressHash: "ip-hash-3",
    userAgentHash: "ua-hash-3",
    deviceType: "desktop",
    occurredAt: "2026-04-20T15:00:00.000Z",
  },
  {
    id: createFixtureId(4010, 4),
    postingId: createFixtureId(2000, 16),
    viewerHash: "viewer-hash-4",
    userEmail: "user3@rentify.local",
    ipAddressHash: "ip-hash-4",
    userAgentHash: "ua-hash-4",
    deviceType: "mobile",
    occurredAt: "2026-04-21T10:00:00.000Z",
  },
  {
    id: createFixtureId(4010, 5),
    postingId: createFixtureId(2000, 18),
    viewerHash: "viewer-hash-5",
    userEmail: "user4@rentify.local",
    ipAddressHash: "ip-hash-5",
    userAgentHash: "ua-hash-5",
    deviceType: "desktop",
    occurredAt: "2026-04-21T13:00:00.000Z",
  },
  {
    id: createFixtureId(4010, 6),
    postingId: createFixtureId(2000, 21),
    viewerHash: "viewer-hash-6",
    userEmail: "viewer1@rentify.local",
    ipAddressHash: "ip-hash-6",
    userAgentHash: "ua-hash-6",
    deviceType: "tablet",
    occurredAt: "2026-04-22T08:30:00.000Z",
  },
  {
    id: createFixtureId(4010, 7),
    postingId: createFixtureId(2000, 23),
    viewerHash: "viewer-hash-7",
    userEmail: "user1@rentify.local",
    ipAddressHash: "ip-hash-7",
    userAgentHash: "ua-hash-7",
    deviceType: "mobile",
    occurredAt: "2026-04-22T11:20:00.000Z",
  },
  {
    id: createFixtureId(4010, 8),
    postingId: createFixtureId(2000, 29),
    viewerHash: "viewer-hash-8",
    userEmail: "user2@rentify.local",
    ipAddressHash: "ip-hash-8",
    userAgentHash: "ua-hash-8",
    deviceType: "desktop",
    occurredAt: "2026-04-22T14:45:00.000Z",
  },
  {
    id: createFixtureId(4010, 9),
    postingId: createFixtureId(2000, 30),
    viewerHash: "viewer-hash-9",
    userEmail: "user3@rentify.local",
    ipAddressHash: "ip-hash-9",
    userAgentHash: "ua-hash-9",
    deviceType: "desktop",
    occurredAt: "2026-04-23T09:40:00.000Z",
  },
  {
    id: createFixtureId(4010, 10),
    postingId: createFixtureId(2000, 6),
    viewerHash: "viewer-hash-10",
    userEmail: "user4@rentify.local",
    ipAddressHash: "ip-hash-10",
    userAgentHash: "ua-hash-10",
    deviceType: "mobile",
    occurredAt: "2026-04-23T12:00:00.000Z",
  },
  {
    id: createFixtureId(4010, 11),
    postingId: createFixtureId(2000, 15),
    viewerHash: "viewer-hash-11",
    userEmail: "viewer1@rentify.local",
    ipAddressHash: "ip-hash-11",
    userAgentHash: "ua-hash-11",
    deviceType: "desktop",
    occurredAt: "2026-04-23T15:15:00.000Z",
  },
  {
    id: createFixtureId(4010, 12),
    postingId: createFixtureId(2000, 27),
    viewerHash: "viewer-hash-12",
    userEmail: "user1@rentify.local",
    ipAddressHash: "ip-hash-12",
    userAgentHash: "ua-hash-12",
    deviceType: "mobile",
    occurredAt: "2026-04-24T17:15:00.000Z",
  },
];

const BASE_SEED_ANALYTICS_OUTBOX_EVENTS: SeedPostingAnalyticsOutboxFixture[] = [
  {
    id: createFixtureId(4020, 1),
    postingId: createFixtureId(2000, 1),
    eventType: "posting_viewed",
    payload: {
      occurredAt: "2026-04-24T09:00:00.000Z",
      viewerHash: "viewer-hash-1",
      userId: createFixtureId(1000, 9),
      ipAddressHash: "ip-hash-1",
      userAgentHash: "ua-hash-1",
      deviceType: "desktop",
      source: "seed",
    },
    attempts: 0,
    availableAt: "2026-04-24T09:00:00.000Z",
    processedAt: "2026-04-24T09:01:00.000Z",
  },
  {
    id: createFixtureId(4020, 2),
    postingId: createFixtureId(2000, 11),
    eventType: "booking_requested",
    payload: {
      occurredAt: "2026-04-24T10:00:00.000Z",
      estimatedTotal: 120,
      bookingId: createFixtureId(3000, 5),
      source: "seed",
    },
    attempts: 0,
    availableAt: "2026-04-24T10:00:00.000Z",
    processedAt: "2026-04-24T10:01:00.000Z",
  },
  {
    id: createFixtureId(4020, 3),
    postingId: createFixtureId(2000, 16),
    eventType: "renting_confirmed",
    payload: {
      occurredAt: "2026-04-24T11:00:00.000Z",
      estimatedTotal: 495,
      bookingId: createFixtureId(3000, 15),
      source: "seed",
    },
    attempts: 0,
    availableAt: "2026-04-24T11:00:00.000Z",
    processedAt: "2026-04-24T11:01:00.000Z",
  },
  {
    id: createFixtureId(4020, 4),
    postingId: createFixtureId(2000, 21),
    eventType: "renting_confirmed",
    payload: {
      occurredAt: "2026-04-24T12:00:00.000Z",
      estimatedTotal: 420,
      paymentId: createFixtureId(3300, 16),
      source: "seed",
    },
    attempts: 0,
    availableAt: "2026-04-24T12:00:00.000Z",
    processedAt: "2026-04-24T12:01:00.000Z",
  },
  {
    id: createFixtureId(4020, 5),
    postingId: createFixtureId(2000, 23),
    eventType: "posting_viewed",
    payload: {
      occurredAt: "2026-04-24T13:00:00.000Z",
      viewerHash: "viewer-hash-7",
      userId: createFixtureId(1000, 5),
      ipAddressHash: "ip-hash-7",
      userAgentHash: "ua-hash-7",
      deviceType: "mobile",
      source: "seed",
    },
    attempts: 1,
    availableAt: "2026-04-24T13:00:00.000Z",
    processedAt: "2026-04-24T13:05:00.000Z",
  },
  {
    id: createFixtureId(4020, 6),
    postingId: createFixtureId(2000, 29),
    eventType: "renting_confirmed",
    payload: {
      occurredAt: "2026-04-24T14:00:00.000Z",
      estimatedTotal: 516,
      paymentId: createFixtureId(3300, 26),
      source: "seed",
    },
    attempts: 0,
    availableAt: "2026-04-24T14:00:00.000Z",
    processedAt: "2026-04-24T14:01:00.000Z",
  },
];

const REVIEWER_EMAIL_PAIRS: Array<[string, string]> = [
  ["user9@rentify.local", "user10@rentify.local"],
  ["user11@rentify.local", "user12@rentify.local"],
  ["user13@rentify.local", "user14@rentify.local"],
  ["user1@rentify.local", "user2@rentify.local"],
  ["user3@rentify.local", "user4@rentify.local"],
  ["user5@rentify.local", "user6@rentify.local"],
  ["user7@rentify.local", "user8@rentify.local"],
  ["user9@rentify.local", "user11@rentify.local"],
  ["user10@rentify.local", "user12@rentify.local"],
  ["user13@rentify.local", "user1@rentify.local"],
  ["user14@rentify.local", "user2@rentify.local"],
  ["user3@rentify.local", "user4@rentify.local"],
];

function createFixtureTimestamp(
  dayOffset: number,
  hour: number,
  minute = 0,
): string {
  return new Date(
    Date.UTC(2026, 4, 1 + dayOffset, hour, minute, 0),
  ).toISOString();
}

const ADDITIONAL_SEED_POSTING_REVIEWS: SeedPostingReviewFixture[] =
  EXPANDED_SEED_ORGANIZATIONS.flatMap((organization, index) => {
    const [reviewerOne, reviewerTwo] = REVIEWER_EMAIL_PAIRS[index]!;
    const postingId = getExpandedPostingId(organization.ownerEmail, 0);

    return [
      {
        id: createFixtureId(4000, 13 + index * 2),
        postingId,
        reviewerEmail: reviewerOne,
        rating: index % 3 === 0 ? 5 : 4,
        title: `${organization.city} stay worked smoothly`,
        comment: `Strong handoff, clean setup, and a dependable base for ${organization.focusTag} work.`,
        createdAt: createFixtureTimestamp(index * 2, 18),
      },
      {
        id: createFixtureId(4000, 14 + index * 2),
        postingId,
        reviewerEmail: reviewerTwo,
        rating: 5,
        title: `Would book ${organization.city} again`,
        comment: `The listing felt organized, photogenic, and easy to use for a short ${organization.city.toLowerCase()} run.`,
        createdAt: createFixtureTimestamp(index * 2 + 1, 19, 15),
      },
    ];
  });

const ADDITIONAL_SEED_POSTING_VIEW_EVENTS: SeedPostingViewEventFixture[] =
  EXPANDED_SEED_ORGANIZATIONS.flatMap((organization, index) => {
    const [reviewerOne, reviewerTwo] = REVIEWER_EMAIL_PAIRS[index]!;
    const postingId = getExpandedPostingId(organization.ownerEmail, 0);

    return [
      {
        id: createFixtureId(4010, 13 + index * 2),
        postingId,
        viewerHash: `${organization.ownerSlug}-viewer-a`,
        userEmail: reviewerOne,
        ipAddressHash: `${organization.ownerSlug}-ip-a`,
        userAgentHash: `${organization.ownerSlug}-ua-a`,
        deviceType: index % 2 === 0 ? "desktop" : "mobile",
        occurredAt: createFixtureTimestamp(24 + index, 9, 10),
      },
      {
        id: createFixtureId(4010, 14 + index * 2),
        postingId,
        viewerHash: `${organization.ownerSlug}-viewer-b`,
        userEmail: reviewerTwo,
        ipAddressHash: `${organization.ownerSlug}-ip-b`,
        userAgentHash: `${organization.ownerSlug}-ua-b`,
        deviceType: index % 3 === 0 ? "tablet" : "desktop",
        occurredAt: createFixtureTimestamp(24 + index, 14, 25),
      },
    ];
  });

const ADDITIONAL_SEED_ANALYTICS_OUTBOX_EVENTS: SeedPostingAnalyticsOutboxFixture[] =
  EXPANDED_SEED_ORGANIZATIONS.map((organization, index) => {
    const postingId = getExpandedPostingId(organization.ownerEmail, 0);
    const eventId = 7 + index;
    const occurredAt = createFixtureTimestamp(40 + index, 10 + (index % 4));

    if (index % 2 === 0) {
      return {
        id: createFixtureId(4020, eventId),
        postingId,
        eventType: "posting_viewed",
        payload: {
          occurredAt,
          viewerHash: `${organization.ownerSlug}-viewer-a`,
          userId: createFixtureId(1000, 28 + (index % 6)),
          ipAddressHash: `${organization.ownerSlug}-ip-a`,
          userAgentHash: `${organization.ownerSlug}-ua-a`,
          deviceType: index % 2 === 0 ? "desktop" : "mobile",
          source: "seed",
        },
        attempts: 0,
        availableAt: occurredAt,
        processedAt: createFixtureTimestamp(40 + index, 10 + (index % 4), 2),
      };
    }

    return {
      id: createFixtureId(4020, eventId),
      postingId,
      eventType: "renting_confirmed",
      payload: {
        occurredAt,
        estimatedTotal: 328 + index * 14,
        bookingId: createFixtureId(3000, 28 + index * 2 + 1),
        source: "seed",
      },
      attempts: 0,
      availableAt: occurredAt,
      processedAt: createFixtureTimestamp(40 + index, 10 + (index % 4), 2),
    };
  });

export const SEED_POSTING_REVIEWS: SeedPostingReviewFixture[] = [
  ...BASE_SEED_POSTING_REVIEWS,
  ...ADDITIONAL_SEED_POSTING_REVIEWS,
];

// Organization reviews are authored by non-member renters who completed a
// rental with the organization. owner1@rentify.local owns postings 2000-3 /
// 2000-4, which renter-five (user5) and renter-six (user6) rented to
// completion (see the completed-renting booking fixtures), so both satisfy the
// service's eligibility rules (completed rental + not an organization member).
export const SEED_ORGANIZATION_REVIEWS: SeedOrganizationReviewFixture[] = [
  {
    id: createFixtureId(4200, 1),
    ownerEmail: "owner1@rentify.local",
    reviewerEmail: "user5@rentify.local",
    rating: 5,
    title: "Consistently great to rent from",
    comment:
      "Every booking with this team has been smooth — clear instructions and quick responses.",
    createdAt: "2026-06-20T18:00:00.000Z",
    reply: {
      body: "Thank you! We love having you back — see you next time.",
      authorEmail: "owner1@rentify.local",
      respondedAt: "2026-06-21T09:30:00.000Z",
    },
  },
  {
    id: createFixtureId(4200, 2),
    ownerEmail: "owner1@rentify.local",
    reviewerEmail: "user6@rentify.local",
    rating: 4,
    title: "Reliable organization",
    comment:
      "Handoffs are dependable and the listings match reality. Would rent again.",
    createdAt: "2026-06-22T16:45:00.000Z",
  },
];

// Wishlist entries so /saved is browsable on a fresh stack. These reference
// postings owned by organizations the saver is not a member of, which is the
// ordinary renter case, and are ordered oldest-first here so the newest save
// lands at the top of the list.
export const SEED_SAVED_POSTINGS: SeedSavedPostingFixture[] = [
  {
    id: createFixtureId(4300, 1),
    postingId: createFixtureId(2000, 11),
    userEmail: "user1@rentify.local",
    createdAt: "2026-07-28T10:15:00.000Z",
  },
  {
    id: createFixtureId(4300, 2),
    postingId: createFixtureId(2000, 16),
    userEmail: "user1@rentify.local",
    createdAt: "2026-07-30T14:40:00.000Z",
  },
  {
    id: createFixtureId(4300, 3),
    postingId: createFixtureId(2000, 21),
    userEmail: "user1@rentify.local",
    createdAt: "2026-08-01T09:05:00.000Z",
  },
  {
    id: createFixtureId(4300, 4),
    postingId: createFixtureId(2000, 16),
    userEmail: "user2@rentify.local",
    createdAt: "2026-07-31T17:20:00.000Z",
  },
  {
    id: createFixtureId(4300, 5),
    postingId: createFixtureId(2000, 29),
    userEmail: "user2@rentify.local",
    createdAt: "2026-08-02T11:50:00.000Z",
  },
];

/**
 * Two searches for renter-one, chosen to make both states visible without
 * waiting on the sweep: the first has live matches that are deliberately not
 * in `seenPostingIds`, so it renders a new-match badge; the second matches
 * nothing at all, which is the state the whole feature exists for.
 */
export const SEED_SAVED_SEARCHES: SeedSavedSearchFixture[] = [
  {
    id: createFixtureId(4400, 1),
    userEmail: "user1@rentify.local",
    name: "Equipment under $80/day",
    queryParams: {
      family: "equipment",
      maxDailyPrice: 80,
    },
    notifyFrequency: "instant",
    createdAt: "2026-08-10T09:00:00.000Z",
    newMatchCount: 2,
  },
  {
    id: createFixtureId(4400, 2),
    userEmail: "user1@rentify.local",
    name: "Lighthouse keeper cottage",
    queryParams: {
      q: "lighthouse keeper cottage",
      family: "place",
    },
    notifyFrequency: "instant",
    createdAt: "2026-08-12T18:30:00.000Z",
  },
  {
    id: createFixtureId(4400, 3),
    userEmail: "user2@rentify.local",
    name: "Vehicles near the harbour",
    queryParams: {
      family: "vehicle",
    },
    notifyFrequency: "daily",
    createdAt: "2026-08-14T07:45:00.000Z",
  },
];

export const SEED_POSTING_VIEW_EVENTS: SeedPostingViewEventFixture[] = [
  ...BASE_SEED_POSTING_VIEW_EVENTS,
  ...ADDITIONAL_SEED_POSTING_VIEW_EVENTS,
];

export const SEED_ANALYTICS_OUTBOX_EVENTS: SeedPostingAnalyticsOutboxFixture[] =
  [
    ...BASE_SEED_ANALYTICS_OUTBOX_EVENTS,
    ...ADDITIONAL_SEED_ANALYTICS_OUTBOX_EVENTS,
  ];
