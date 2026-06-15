import yaml from "js-yaml";

type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

interface OperationDefinition {
  method: HttpMethod;
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  security?: Array<Record<string, unknown>>;
  permissions: Record<string, unknown>;
  parameters?: unknown[];
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
}

function stripUndefinedDeep<TValue>(value: TValue): TValue {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as TValue;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);

    return Object.fromEntries(entries) as TValue;
  }

  return value;
}

const requestIdExample = "req_01HZY9ZX8D3G7ZP5QJ7S3C4D5E";
const authSessionExample = {
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
  device: {
    deviceId: "device-1",
    known: true,
    knownByIp: true,
  },
  user: {
    id: "user-1",
    email: "owner1@rentify.local",
    username: "owner-one",
    avatarUrl: "https://cdn.rentify.local/avatars/owner-1.png",
    role: "owner",
    activeOrganization: {
      id: "org-1",
      name: "Owner One Organization",
      role: "primary_manager",
    },
    organizationMembershipCount: 1,
  },
};
const signupPendingExample = {
  verificationRequired: true,
  email: "new-user@example.com",
  alreadyPending: false,
};
const organizationSummaryExample = {
  id: "org-1",
  name: "Northwind",
  role: "primary_manager",
};
const organizationMembershipSummaryExample = {
  membershipId: "membership-1",
  ...organizationSummaryExample,
  joinedAt: "2026-05-01T00:00:00.000Z",
  isActive: true,
};
const organizationMemberExample = {
  membershipId: "membership-2",
  userId: "user-2",
  email: "teammate@example.com",
  firstName: "Taylor",
  lastName: "Operator",
  username: "taylor-operator",
  avatarUrl: "https://cdn.rentify.local/avatars/user-2.png",
  role: "operator",
  joinedAt: "2026-05-03T10:00:00.000Z",
};
const organizationInviteExample = {
  id: "invite-1",
  email: "teammate@example.com",
  emailHint: "t***@example.com",
  role: "operator",
  status: "pending",
  expiresAt: "2026-06-04T10:00:00.000Z",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  invitedBy: {
    id: "user-1",
    email: "owner1@rentify.local",
    username: "owner-one",
  },
};
const organizationWorkspaceExample = {
  memberships: [organizationMembershipSummaryExample],
  activeOrganization: organizationSummaryExample,
};
const organizationDetailExample = {
  organization: {
    id: "org-1",
    name: "Northwind",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-28T10:00:00.000Z",
  },
  viewerRole: "primary_manager",
  members: [
    {
      membershipId: "membership-1",
      userId: "user-1",
      email: "owner1@rentify.local",
      firstName: "Owner",
      lastName: "One",
      username: "owner-one",
      avatarUrl: "https://cdn.rentify.local/avatars/owner-1.png",
      role: "primary_manager",
      joinedAt: "2026-05-01T00:00:00.000Z",
    },
    organizationMemberExample,
  ],
  invitations: [organizationInviteExample],
};
const organizationInvitePreviewExample = {
  invitation: {
    organizationId: "org-1",
    organizationName: "Northwind",
    emailHint: "t***@example.com",
    role: "operator",
    status: "pending",
    expiresAt: "2026-06-04T10:00:00.000Z",
  },
  viewer: {
    authenticated: true,
    email: "teammate@example.com",
    emailVerified: true,
    matchesEmail: true,
    canAccept: true,
  },
};
const organizationInviteAcceptedExample = {
  accepted: true,
  organization: {
    id: "org-1",
    name: "Northwind",
    role: "operator",
  },
  membership: {
    membershipId: "membership-2",
    id: "org-1",
    name: "Northwind",
    role: "operator",
    joinedAt: "2026-05-28T10:30:00.000Z",
    isActive: true,
  },
};
const linkedProvidersExample = {
  hasPassword: true,
  providers: [
    {
      id: "oauth-1",
      provider: "google",
      providerEmail: "owner1@rentify.local",
      emailVerified: true,
      displayName: "Owner One",
      linkedAt: "2026-05-20T10:00:00.000Z",
    },
  ],
};
const knownDevicesExample = {
  devices: [
    {
      id: "device-1",
      label: "Chrome on macOS",
      lastSeenAt: "2026-05-25T14:00:00.000Z",
      knownByIp: true,
      current: true,
    },
  ],
};
const verificationStatusExample = {
  verified: true,
  auth: {
    userId: "user-1",
    deviceId: "device-1",
    role: "user",
  },
  client: {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "Mozilla/5.0",
      platform: "macOS",
    },
  },
};
const actionAcceptedExample = {
  accepted: true,
};
const actionOkExample = {
  ok: true,
};
const personalAccessTokenSummaryExample = {
  id: "pat-1",
  name: "Rentify MCP",
  tokenPrefix: "rpat_live_",
  scopes: ["mcp:read", "mcp:write"],
  lastUsedAt: "2026-05-24T08:00:00.000Z",
  expiresAt: "2026-08-01T00:00:00.000Z",
  revokedAt: undefined,
  createdAt: "2026-05-24T08:00:00.000Z",
  updatedAt: "2026-05-24T08:00:00.000Z",
};
const personalAccessTokenCreateExample = {
  ...personalAccessTokenSummaryExample,
  token: "rpat_live_secret_token",
};
const blobUploadTargetExample = {
  method: "PUT",
  uploadUrl:
    "https://storage.example.net/rentify/uploads/photo-1.jpg?sig=abc123",
  expiresAt: "2026-05-25T18:30:00.000Z",
  blobName: "uploads/photo-1.jpg",
  blobUrl: "https://cdn.rentify.local/uploads/photo-1.jpg",
  container: "rentify",
  headers: {
    "x-ms-blob-type": "BlockBlob",
    "Content-Type": "image/jpeg",
  },
};
const publicProfileExample = {
  id: "profile-1",
  userId: "user-1",
  email: "user1@rentify.local",
  firstName: "Taylor",
  lastName: "Renter",
  username: "taylor-renter",
  phoneNumber: "+1 555 0100",
  avatarUrl: "https://cdn.rentify.local/avatars/user-1.png",
  trustworthinessScore: 4,
  rentPostingsCount: 2,
  availableRentPostingsCount: 1,
  createdAt: "2026-04-10T09:00:00.000Z",
  updatedAt: "2026-05-25T09:00:00.000Z",
};
const privateProfileExample = {
  ...publicProfileExample,
  avatarBlobName: "avatars/user-1.png",
  isPrivate: false,
  recommendationPersonalizationEnabled: true,
};
const postingExample = {
  id: "posting-1",
  organizationId: "org-1",
  organization: {
    id: "org-1",
    name: "Owner One Organization",
  },
  status: "published",
  variant: {
    family: "place",
    subtype: "workspace",
  },
  name: "Sunny loft workspace",
  description: "Bright downtown loft with desks and meeting space.",
  pricing: {
    currency: "CAD",
    daily: {
      amount: 150,
    },
    hourly: {
      amount: 25,
    },
  },
  pricingCurrency: "CAD",
  photos: [
    {
      id: "photo-1",
      blobUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
      blobName: "postings/posting-1/photo-1.jpg",
      thumbnailBlobUrl:
        "https://cdn.rentify.local/postings/posting-1/photo-1-thumb.jpg",
      thumbnailBlobName: "postings/posting-1/photo-1-thumb.jpg",
      position: 0,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z",
    },
  ],
  tags: ["workspace", "wifi"],
  details: {
    guest_capacity: 4,
    property_type: "loft",
    amenities: ["wifi", "coffee"],
    parking: true,
  },
  availabilityStatus: "available",
  availabilityNotes: "Best for weekday bookings.",
  maxBookingDurationDays: 30,
  effectiveMaxBookingDurationDays: 30,
  availabilityBlocks: [
    {
      id: "block-1",
      startAt: "2026-06-10T00:00:00.000Z",
      endAt: "2026-06-12T00:00:00.000Z",
      note: "Owner maintenance",
      createdAt: "2026-05-10T10:00:00.000Z",
      updatedAt: "2026-05-10T10:00:00.000Z",
    },
  ],
  location: {
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    postalCode: "M5V 1A1",
    latitude: 43.65,
    longitude: -79.38,
  },
  primaryPhotoUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
  primaryThumbnailUrl:
    "https://cdn.rentify.local/postings/posting-1/photo-1-thumb.jpg",
  viewerReviewState: {
    eligible: true,
    hasOwnReview: false,
  },
  publishedAt: "2026-05-01T10:00:00.000Z",
  pausedAt: undefined,
  archivedAt: undefined,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-20T09:00:00.000Z",
};
const searchResultExample = {
  postings: [postingExample],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  source: "elasticsearch",
  query: "loft",
};
const autocompleteExample = {
  query: "lo",
  suggestions: [
    {
      value: "loft",
      kind: "tag",
    },
    {
      value: "Loft workspace",
      kind: "name",
    },
  ],
  source: "elasticsearch",
};
const recommendationExample = {
  items: [
    {
      posting: postingExample,
      reasonCodes: ["similar_family", "nearby"],
    },
  ],
  pagination: searchResultExample.pagination,
  mode: "personalized",
  fallback: false,
  snapshotGeneratedAt: "2026-05-25T14:00:00.000Z",
};
const reviewExample = {
  id: "review-1",
  postingId: "posting-1",
  reviewerId: "user-1",
  rating: 5,
  title: "Great space",
  comment: "Exactly as advertised and easy to book.",
  reviewer: {
    username: "taylor-renter",
    avatarUrl: "https://cdn.rentify.local/avatars/user-1.png",
  },
  createdAt: "2026-05-18T10:00:00.000Z",
  updatedAt: "2026-05-18T10:00:00.000Z",
};
const reportExample = {
  id: "report-1",
  reporterId: "user-1",
  subjectType: "posting",
  subjectId: "posting-1",
  reasonCode: "fraud_or_scam",
  title: "Payment requested off-platform",
  description:
    "The listing description asks renters to contact a private number and pay by wire transfer.",
  status: "open",
  createdAt: "2026-05-25T15:00:00.000Z",
  updatedAt: "2026-05-25T15:00:00.000Z",
  reporter: {
    id: "user-1",
    email: "user1@rentify.local",
    username: "renter-one",
    avatarUrl: "https://cdn.rentify.local/avatars/user-1.png",
    role: "user",
  },
  assignedModerator: {
    id: "moderator-1",
    email: "moderator1@rentify.local",
    username: "mod-one",
    avatarUrl: "https://cdn.rentify.local/avatars/mod-1.png",
    role: "moderator",
  },
  subjectSnapshot: {
    subjectType: "posting",
    summaryText: "Sunny loft workspace published Owner One Organization",
    posting: {
      id: "posting-1",
      name: "Sunny loft workspace",
      status: "published",
      organization: {
        id: "org-1",
        name: "Owner One Organization",
      },
    },
  },
};
const reportDetailExample = {
  ...reportExample,
  reviewedAt: "2026-05-25T16:00:00.000Z",
  events: [
    {
      id: "report-event-1",
      eventType: "created",
      actor: reportExample.reporter,
      createdAt: "2026-05-25T15:00:00.000Z",
      note: "Initial report submitted by renter.",
    },
    {
      id: "report-event-2",
      eventType: "assigned",
      actor: reportExample.assignedModerator,
      assignmentUserId: "moderator-1",
      createdAt: "2026-05-25T15:10:00.000Z",
      note: "Assigned for manual review.",
    },
  ],
};
const reportsListExample = {
  reports: [reportExample],
  pagination: searchResultExample.pagination,
  source: "elasticsearch",
  query: "wire transfer",
};
const feedbackReceiptExample = {
  id: "feedback-1",
  category: "feature_request",
  createdAt: "2026-06-15T12:00:00.000Z",
};
const analyticsSummaryExample = {
  window: "7d",
  totals: {
    searchImpressions: 120,
    searchClicks: 28,
    views: 32,
    uniqueViews: 24,
    bookingRequests: 4,
    approvedRequests: 2,
    declinedRequests: 1,
    expiredRequests: 0,
    cancelledRequests: 1,
    paymentFailedRequests: 0,
    confirmedBookings: 2,
    estimatedConfirmedRevenue: 900,
    refundedRevenue: 0,
    activeDaysPublished: 7,
    calendarBlockedDays: 2,
    confirmedBookedDays: 4,
  },
  derivedMetrics: {
    ctr: 0.23,
    viewToRequestRate: 0.13,
    clickToRequestRate: 0.14,
    requestToApprovalRate: 0.5,
    requestToConfirmedRate: 0.5,
    utilizationRate: 0.57,
    averageRevenuePerConfirmedBooking: 450,
  },
  dataAvailability: {
    searchImpressions: "live",
    searchClicks: "live",
    views: "live",
    bookingRequests: "live",
    requestOutcomes: "live",
    confirmedBookings: "live",
    revenue: "live",
    isPartial: false,
  },
  range: {
    startAt: "2026-05-18T00:00:00.000Z",
    endAt: "2026-05-25T00:00:00.000Z",
  },
};
const analyticsDetailExample = {
  postingId: "posting-1",
  name: "Sunny loft workspace",
  status: "published",
  primaryPhotoUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
  window: "7d",
  granularity: "day",
  totals: analyticsSummaryExample.totals,
  derivedMetrics: analyticsSummaryExample.derivedMetrics,
  buckets: [
    {
      bucketStart: "2026-05-24T00:00:00.000Z",
      bucketEnd: "2026-05-25T00:00:00.000Z",
      granularity: "day",
      metrics: {
        searchImpressions: 18,
        searchClicks: 5,
        views: 6,
        uniqueViews: 5,
        bookingRequests: 1,
        approvedRequests: 0,
        declinedRequests: 0,
        expiredRequests: 0,
        cancelledRequests: 0,
        paymentFailedRequests: 0,
        confirmedBookings: 0,
        estimatedConfirmedRevenue: 0,
        refundedRevenue: 0,
      },
      derivedMetrics: {
        ctr: 0.28,
        viewToRequestRate: 0.16,
        clickToRequestRate: 0.2,
        requestToApprovalRate: 0,
        requestToConfirmedRate: 0,
        utilizationRate: 0,
        averageRevenuePerConfirmedBooking: 0,
      },
    },
  ],
  dataAvailability: analyticsSummaryExample.dataAvailability,
  range: analyticsSummaryExample.range,
};
const bookingRequestExample = {
  id: "booking-1",
  postingId: "posting-1",
  renterId: "user-1",
  organizationId: "org-1",
  status: "approved",
  startAt: "2026-06-14T15:00:00.000Z",
  endAt: "2026-06-17T11:00:00.000Z",
  durationDays: 3,
  guestCount: 2,
  contactName: "Taylor Renter",
  contactEmail: "user1@rentify.local",
  contactPhoneNumber: "+1 555 0100",
  note: "Need reliable Wi-Fi for a client workshop.",
  pricingCurrency: "CAD",
  pricingSnapshot: postingExample.pricing,
  dailyPriceAmount: 150,
  estimatedTotal: 450,
  decisionNote: "Approved for the requested dates.",
  approvedAt: "2026-05-25T12:00:00.000Z",
  paymentRequiredAt: "2026-05-25T12:05:00.000Z",
  holdExpiresAt: "2026-05-28T12:00:00.000Z",
  createdAt: "2026-05-25T11:00:00.000Z",
  updatedAt: "2026-05-25T12:00:00.000Z",
  posting: {
    id: "posting-1",
    name: "Sunny loft workspace",
    primaryPhotoUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
    effectiveMaxBookingDurationDays: 30,
  },
};
const bookingQuoteExample = {
  postingId: "posting-1",
  bookable: true,
  durationDays: 3,
  pricingCurrency: "CAD",
  dailyPriceAmount: 150,
  estimatedTotal: 450,
  maxBookingDurationDays: 30,
  failureReasons: [],
};
const bookingCancellationQuoteExample = {
  bookingRequestId: "booking-1",
  cancellable: true,
  actor: "renter",
  bookingStatus: "approved",
  reasonRequired: false,
  policyCode: "platform_default_v1",
  refundType: "partial",
  refundAmount: 225,
  currency: "CAD",
  failureReasons: [],
};
const paymentExample = {
  id: "payment-1",
  bookingRequestId: "booking-1",
  postingId: "posting-1",
  renterId: "user-1",
  organizationId: "org-1",
  provider: "square",
  status: "awaiting_method",
  pricingCurrency: "CAD",
  rentalSubtotalAmount: 450,
  platformFeeAmount: 45,
  totalAmount: 495,
  squarePaymentId: "sq-payment-1",
  squareOrderId: "sq-order-1",
  squareLocationId: "sq-location-1",
  checkoutUrl: "https://square.link/u/abc123",
  createdAt: "2026-05-25T12:05:00.000Z",
  updatedAt: "2026-05-25T12:05:00.000Z",
  booking: {
    id: "booking-1",
    status: "awaiting_payment",
    startAt: "2026-06-14T15:00:00.000Z",
    endAt: "2026-06-17T11:00:00.000Z",
    holdExpiresAt: "2026-05-28T12:00:00.000Z",
    paymentReconciliationRequired: false,
  },
  attempts: [],
  refunds: [],
};
const payoutExample = {
  id: "payout-1",
  paymentId: "payment-1",
  organizationId: "org-1",
  status: "scheduled",
  amount: 405,
  dueAt: "2026-06-17T12:00:00.000Z",
  createdAt: "2026-05-25T12:05:00.000Z",
  updatedAt: "2026-05-25T12:05:00.000Z",
};
const rentingExample = {
  id: "renting-1",
  postingId: "posting-1",
  bookingRequestId: "booking-1",
  renterId: "user-1",
  organizationId: "org-1",
  status: "confirmed",
  startAt: "2026-06-14T15:00:00.000Z",
  endAt: "2026-06-17T11:00:00.000Z",
  durationDays: 3,
  guestCount: 2,
  pricingCurrency: "CAD",
  pricingSnapshot: postingExample.pricing,
  dailyPriceAmount: 150,
  estimatedTotal: 450,
  confirmedAt: "2026-05-26T09:00:00.000Z",
  pickupInstructions: "Front desk will release the keys after ID check.",
  returnInstructions: "Leave keys in the lockbox by checkout.",
  createdAt: "2026-05-26T09:00:00.000Z",
  updatedAt: "2026-05-26T09:00:00.000Z",
  posting: {
    id: "posting-1",
    name: "Sunny loft workspace",
    primaryPhotoUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
  },
};
const searchStatusExample = {
  aliases: {
    read: "postings-read",
    write: "postings-write",
    readTargets: ["postings_v3"],
    writeTargets: ["postings_v3"],
    health: {
      state: "ready",
      readAlias: "postings-read",
      writeAlias: "postings-write",
      readTargets: ["postings_v3"],
      writeTargets: ["postings_v3"],
    },
  },
  elasticsearch: {
    enabled: true,
    circuitBreaker: {
      state: "closed",
      consecutiveFailures: 0,
      failureThreshold: 5,
      cooldownMs: 30000,
    },
    telemetry: {
      total: 100,
      totalLatencyMs: 2400,
      serverErrorCount: 0,
      timeoutCount: 0,
      transportErrorCount: 0,
      openedCount: 0,
      shortCircuitCount: 0,
    },
  },
  currentReindexRun: {
    id: "reindex-1",
    status: "running",
    targetIndexName: "postings_v4",
    sourceSnapshotAt: "2026-05-25T10:00:00.000Z",
    totalPostings: 62,
    indexedPostings: 40,
    failedPostings: 0,
    startedAt: "2026-05-25T10:05:00.000Z",
    createdAt: "2026-05-25T10:05:00.000Z",
    updatedAt: "2026-05-25T10:10:00.000Z",
  },
  pendingOutboxCount: 2,
  pendingOutboxOldestAgeMs: 12000,
  lag: {
    unpublishedCount: 1,
    unpublishedOldestAgeMs: 4000,
    publishedNotIndexedCount: 1,
    publishedNotIndexedOldestAgeMs: 8000,
    deadLetteredByOperation: {
      upsert: 0,
      delete: 0,
      barrier: 0,
    },
  },
  queueInspection: {
    ok: true,
  },
  queueCounts: {
    main: {
      ready: 0,
      consumers: 1,
    },
    retry1: {
      ready: 0,
      consumers: 1,
    },
    retry2: {
      ready: 0,
      consumers: 1,
    },
    retry3: {
      ready: 0,
      consumers: 1,
    },
    deadLetter: {
      ready: 0,
      consumers: 1,
    },
  },
  telemetry: {
    fallbacks: {
      "circuit-open": 0,
      "es-unavailable": 0,
      "index-drift": 0,
    },
    queueInspectionFailures: 0,
    reindexRuns: {
      completed: 4,
      failed: 0,
      lastDurationMs: 180000,
    },
    aliasActions: {
      createdIndexCount: 4,
      repairedReadAliasCount: 0,
      repairedWriteAliasCount: 0,
      lastAction: "created_index",
    },
  },
};

function schemaRef(name: string): Record<string, string> {
  return {
    $ref: `#/components/schemas/${name}`,
  };
}

function responseRef(name: string): Record<string, string> {
  return {
    $ref: `#/components/responses/${name}`,
  };
}

function parameterRef(name: string): Record<string, string> {
  return {
    $ref: `#/components/parameters/${name}`,
  };
}

function requestBody(
  schemaName: string,
  example: unknown,
  description?: string,
): Record<string, unknown> {
  return {
    required: true,
    ...(description ? { description } : {}),
    content: {
      "application/json": {
        schema: schemaRef(schemaName),
        example,
      },
    },
  };
}

function successEnvelopeSchema(
  dataSchemaName: string,
  metaSchemaName = "RequestMeta",
): Record<string, unknown> {
  return {
    allOf: [
      schemaRef("ApiSuccessEnvelope"),
      {
        type: "object",
        properties: {
          data: schemaRef(dataSchemaName),
          meta: schemaRef(metaSchemaName),
        },
      },
    ],
  };
}

function successResponse(
  status: 200 | 201 | 202,
  message: string,
  dataSchemaName: string,
  dataExample: unknown,
  description = "Successful response.",
  metaExample: Record<string, unknown> = {
    requestId: requestIdExample,
  },
): Record<string, unknown> {
  const example = {
    success: true,
    message,
    data: dataExample,
    error: null,
    meta: metaExample,
  };

  const schemaName =
    metaExample.pagination || metaExample.mode || metaExample.source
      ? "ExtendedRequestMeta"
      : "RequestMeta";

  return {
    description,
    content: {
      "application/json": {
        schema: successEnvelopeSchema(dataSchemaName, schemaName),
        example,
      },
    },
  };
}

function noContentResponse(
  description = "No content.",
): Record<string, unknown> {
  return {
    description,
  };
}

function errorResponse(
  description: string,
  message: string,
  code: string,
  details?: unknown,
): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema: schemaRef("ApiErrorEnvelope"),
        example: {
          success: false,
          message,
          data: null,
          error: {
            code,
            ...(details !== undefined ? { details } : {}),
          },
          meta: {
            requestId: requestIdExample,
          },
        },
      },
    },
  };
}

function commonErrors(
  statuses: Array<400 | 401 | 403 | 404 | 409 | 415 | 422 | 429 | 500 | 503>,
) {
  const result: Record<string, unknown> = {};

  for (const status of statuses) {
    switch (status) {
      case 400:
        result["400"] = responseRef("BadRequest");
        break;
      case 401:
        result["401"] = responseRef("Unauthorized");
        break;
      case 403:
        result["403"] = responseRef("Forbidden");
        break;
      case 404:
        result["404"] = responseRef("NotFound");
        break;
      case 409:
        result["409"] = responseRef("Conflict");
        break;
      case 415:
        result["415"] = responseRef("BadRequest");
        break;
      case 422:
        result["422"] = responseRef("UnprocessableEntity");
        break;
      case 429:
        result["429"] = responseRef("TooManyRequests");
        break;
      case 500:
        result["500"] = responseRef("InternalServerError");
        break;
      case 503:
        result["503"] = responseRef("ServiceUnavailable");
        break;
    }
  }

  return result;
}

function routePathParam(name: string, description: string, example: string) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: {
      type: "string",
    },
    example,
  };
}

function queryParam(
  name: string,
  schema: Record<string, unknown>,
  description: string,
  example?: unknown,
  required = false,
): Record<string, unknown> {
  return {
    name,
    in: "query",
    required,
    description,
    schema,
    ...(example !== undefined ? { example } : {}),
  };
}

function buildOperations(): OperationDefinition[] {
  const ownerSecurity = [{ bearerAuth: [] }];
  const optionalSecurity = [{ bearerAuth: [] }, {}];

  return [
    {
      method: "get",
      path: "/",
      operationId: "getSystemRoot",
      summary: "Get API root metadata",
      description:
        "Returns the current API version and base path for discovery and local smoke checks.",
      tags: ["system"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "TypeScript Hono server is running",
          "SystemRoot",
          {
            apiVersion: "v1",
            apiBasePath: "/api/v1",
          },
        ),
        ...commonErrors([500]),
      },
    },
    {
      method: "get",
      path: "/health",
      operationId: "getHealth",
      summary: "Get service health",
      description:
        "Returns application health with database status. This route is intended for local verification and service monitoring.",
      tags: ["system"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "HealthStatus",
          {
            ok: true,
            uptime: 123.45,
            checks: {
              database: {
                ok: true,
              },
            },
          },
        ),
        "503": errorResponse(
          "Service unavailable.",
          "Health check failed.",
          "SERVICE_UNAVAILABLE",
          {
            uptime: 123.45,
            checks: {
              database: {
                ok: false,
                message: "Database health check failed.",
              },
            },
          },
        ),
        ...commonErrors([500]),
      },
    },
    {
      method: "get",
      path: "/openapi.yaml",
      operationId: "getOpenApiYaml",
      summary: "Download the canonical OpenAPI YAML",
      description:
        "Returns the same `backend/openapi/openapi.yaml` file that is committed to the repository and copied into the backend container.",
      tags: ["system"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      responses: {
        "200": {
          description: "The canonical OpenAPI YAML document.",
          content: {
            "application/yaml": {
              schema: {
                type: "string",
              },
              example: "openapi: 3.1.0",
            },
          },
        },
        ...commonErrors([500]),
      },
    },
    {
      method: "get",
      path: "/openapi.json",
      operationId: "getOpenApiJson",
      summary: "Download the canonical OpenAPI JSON",
      description:
        "Returns the same `backend/openapi/openapi.json` file that is committed to the repository and copied into the backend container.",
      tags: ["system"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      responses: {
        "200": {
          description: "The canonical OpenAPI JSON document.",
          content: {
            "application/json": {
              schema: {
                type: "object",
              },
              example: {
                openapi: "3.1.0",
              },
            },
          },
        },
        ...commonErrors([500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/login",
      operationId: "localLogin",
      summary: "Authenticate with email and password",
      description:
        "Creates an authenticated session with local credentials. Browser clients typically receive the refresh token as an HTTP-only cookie; API clients receive it in the response body.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("LocalAuthenticateRequest", {
        email: "owner1@rentify.local",
        password: "Rentify123!",
        captchaToken: "turnstile-token",
        rememberMe: true,
        deviceId: "device-1",
      }),
      responses: {
        "200": successResponse(
          200,
          "Authenticated successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/signup",
      operationId: "localSignup",
      summary: "Create a new local account",
      description:
        "Begins local signup and sends a verification challenge to the supplied email address.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("LocalSignupRequest", {
        email: "new-user@example.com",
        password: "Rentify123!",
        captchaToken: "turnstile-token",
        firstName: "Taylor",
        lastName: "Renter",
        deviceId: "device-2",
      }),
      responses: {
        "202": successResponse(
          202,
          "Signup verification is pending.",
          "SignupVerificationPendingResult",
          signupPendingExample,
        ),
        ...commonErrors([400, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/password/forgot",
      operationId: "forgotPassword",
      summary: "Request a password reset",
      description:
        "Starts the password reset flow for a local account. The accepted response does not confirm whether the email exists.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("ForgotPasswordRequest", {
        email: "owner1@rentify.local",
        captchaToken: "turnstile-token",
      }),
      responses: {
        "202": successResponse(
          202,
          "Password reset instructions have been accepted.",
          "AcceptedActionResult",
          actionAcceptedExample,
        ),
        ...commonErrors([400, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/password/forgot/resend",
      operationId: "resendForgotPassword",
      summary: "Resend password reset instructions",
      description:
        "Resends the password reset challenge for a local account if the flow is still eligible.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("ForgotPasswordRequest", {
        email: "owner1@rentify.local",
        captchaToken: "turnstile-token",
      }),
      responses: {
        "202": successResponse(
          202,
          "Password reset instructions have been re-sent.",
          "AcceptedActionResult",
          actionAcceptedExample,
        ),
        ...commonErrors([400, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/password/reset",
      operationId: "resetPassword",
      summary: "Complete a password reset",
      description:
        "Completes a local password reset with the emailed code and returns an authenticated session.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
      },
      requestBody: requestBody("ResetPasswordRequest", {
        email: "owner1@rentify.local",
        code: "123456",
        newPassword: "Rentify123!",
        deviceId: "device-1",
      }),
      responses: {
        "200": successResponse(
          200,
          "Password reset successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/email/verify",
      operationId: "verifyEmail",
      summary: "Verify a newly created email address",
      description:
        "Validates the email verification code and returns an authenticated session.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
      },
      requestBody: requestBody("VerifyEmailRequest", {
        email: "new-user@example.com",
        code: "123456",
        deviceId: "device-2",
      }),
      responses: {
        "200": successResponse(
          200,
          "Email verified successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/email/resend",
      operationId: "resendVerificationEmail",
      summary: "Resend email verification",
      description:
        "Resends the pending signup verification email when the flow is still active.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("ResendVerificationEmailRequest", {
        email: "new-user@example.com",
        captchaToken: "turnstile-token",
      }),
      responses: {
        "202": successResponse(
          202,
          "Verification email has been re-sent.",
          "AcceptedActionResult",
          actionAcceptedExample,
        ),
        ...commonErrors([400, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/unlock",
      operationId: "unlockLocalLogin",
      summary: "Unlock a local login",
      description:
        "Completes an account unlock flow for a temporarily locked local login.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
      },
      requestBody: requestBody("UnlockLocalLoginRequest", {
        email: "owner1@rentify.local",
        code: "123456",
      }),
      responses: {
        "200": successResponse(
          200,
          "Local login unlocked successfully.",
          "ActionOkResult",
          actionOkExample,
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/unlock/resend",
      operationId: "resendUnlockLocalLogin",
      summary: "Resend a local login unlock code",
      description:
        "Resends the unlock code for a local account that is currently in a locked state.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("ResendUnlockLocalLoginRequest", {
        email: "owner1@rentify.local",
        captchaToken: "turnstile-token",
      }),
      responses: {
        "202": successResponse(
          202,
          "Unlock email has been re-sent.",
          "AcceptedActionResult",
          actionAcceptedExample,
        ),
        ...commonErrors([400, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/verify",
      operationId: "verifyLocalSession",
      summary: "Verify the current local session",
      description:
        "Verifies the caller's bearer token and returns normalized auth and client information for the current session.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "SessionVerificationResult",
          verificationStatusExample,
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/password/change",
      operationId: "changePassword",
      summary: "Change the current local password",
      description:
        "Changes the current signed-in user's password and returns a refreshed authenticated session.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("ChangePasswordRequest", {
        currentPassword: "Rentify123!",
        newPassword: "NewRentify123!",
      }),
      responses: {
        "200": successResponse(
          200,
          "Password changed successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/refresh",
      operationId: "refreshSession",
      summary: "Refresh an access token",
      description:
        "Refreshes an access token using either the `refreshToken` request body field for native/API clients or the `refresh_token` cookie for browser clients. Browser clients must also send the `x-csrf-token` header when a CSRF cookie is present.",
      tags: ["auth"],
      permissions: {
        authMode: "refresh-token",
        minimumRole: null,
        patAllowed: false,
        cookieAuth: {
          cookie: "refresh_token",
          csrfHeader: "x-csrf-token",
        },
        rateLimitPolicy: "auth-refresh",
      },
      requestBody: requestBody("RefreshRequest", {
        refreshToken: "refresh-token-1",
      }),
      responses: {
        "200": successResponse(
          200,
          "Session refreshed successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/logout",
      operationId: "logoutSession",
      summary: "Log out the current session",
      description:
        "Logs out the current bearer-authenticated session. Browser clients should include the refresh-token cookie and matching CSRF header so the backend can clear them.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        cookieAuth: {
          cookie: "refresh_token",
          csrfHeader: "x-csrf-token",
        },
        rateLimitPolicy: "auth-session",
      },
      responses: {
        "200": successResponse(
          200,
          "Logged out successfully.",
          "ActionOkResult",
          {
            loggedOut: true,
          },
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/oauth/google",
      operationId: "googleAuthenticate",
      summary: "Authenticate with Google OAuth",
      description:
        "Authenticates with Google using either an authorization code plus PKCE verifier or an ID token, depending on the client flow.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "OAuth routes are exempt from browser CSRF enforcement.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("OAuthAuthenticateRequest", {
        code: "auth-code",
        codeVerifier: "pkce-verifier",
        nonce: "nonce-value",
        rememberMe: true,
        deviceId: "device-1",
        firstName: "Taylor",
        lastName: "Owner",
      }),
      responses: {
        "200": successResponse(
          200,
          "Authenticated successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/oauth/microsoft",
      operationId: "microsoftAuthenticate",
      summary: "Authenticate with Microsoft OAuth",
      description:
        "Authenticates with Microsoft using either an authorization code plus PKCE verifier or an ID token, depending on the client flow.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "OAuth routes are exempt from browser CSRF enforcement.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("OAuthAuthenticateRequest", {
        idToken: "microsoft-id-token",
        nonce: "nonce-value",
        rememberMe: false,
        deviceId: "device-2",
      }),
      responses: {
        "200": successResponse(
          200,
          "Authenticated successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/oauth/apple",
      operationId: "appleAuthenticate",
      summary: "Authenticate with Apple OAuth",
      description:
        "Authenticates with Apple using the same shared OAuth request shape used by the other providers.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "OAuth routes are exempt from browser CSRF enforcement.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("OAuthAuthenticateRequest", {
        code: "apple-auth-code",
        codeVerifier: "pkce-verifier",
        nonce: "nonce-value",
      }),
      responses: {
        "200": successResponse(
          200,
          "Authenticated successfully.",
          "AuthSessionResponseData",
          authSessionExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/auth/oauth/providers",
      operationId: "listLinkedOauthProviders",
      summary: "List linked OAuth providers",
      description:
        "Returns the OAuth providers currently linked to the signed-in user account.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "LinkedOAuthProvidersResult",
          linkedProvidersExample,
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/oauth/:provider/link",
      operationId: "linkOauthProvider",
      summary: "Link an OAuth provider to the current account",
      description:
        "Links the selected OAuth provider to the currently signed-in local account.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("provider", "OAuth provider name.", "google"),
      ],
      requestBody: requestBody("OAuthAuthenticateRequest", {
        code: "auth-code",
        codeVerifier: "pkce-verifier",
        nonce: "nonce-value",
      }),
      responses: {
        "200": successResponse(
          200,
          "OAuth provider linked successfully.",
          "LinkedOAuthProvidersResult",
          linkedProvidersExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/auth/oauth/:provider",
      operationId: "unlinkOauthProvider",
      summary: "Unlink an OAuth provider from the current account",
      description:
        "Unlinks the selected OAuth provider from the currently signed-in account.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("provider", "OAuth provider name.", "google"),
      ],
      responses: {
        "200": successResponse(
          200,
          "OAuth provider unlinked successfully.",
          "LinkedOAuthProvidersResult",
          linkedProvidersExample,
        ),
        ...commonErrors([401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/device/verify",
      operationId: "verifyDevice",
      summary: "Verify the current device",
      description:
        "Marks the current device as verified for the signed-in session.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        rateLimitPolicy: "auth-session",
      },
      responses: {
        "200": successResponse(
          200,
          "Device verified successfully.",
          "ActionOkResult",
          actionOkExample,
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/auth/devices",
      operationId: "listKnownDevices",
      summary: "List known devices",
      description:
        "Returns the signed-in user's known devices and current-device information.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "KnownDevicesResult",
          knownDevicesExample,
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/auth/devices/remove",
      operationId: "removeKnownDevice",
      summary: "Remove a known device",
      description:
        "Removes a previously known device from the signed-in user's account.",
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("RemoveKnownDeviceRequest", {
        deviceId: "device-2",
      }),
      responses: {
        "200": successResponse(
          200,
          "Known device removed successfully.",
          "ActionOkResult",
          actionOkExample,
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/auth/personal-access-tokens",
      operationId: "listPersonalAccessTokens",
      summary: "List personal access tokens",
      description:
        "Lists the current signed-in user's personal access tokens. This endpoint requires a signed-in session and does not accept PAT authentication.",
      tags: ["personal-access-tokens"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PersonalAccessTokenListResult",
          {
            tokens: [personalAccessTokenSummaryExample],
          },
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/personal-access-tokens",
      operationId: "createPersonalAccessToken",
      summary: "Create a personal access token",
      description:
        "Creates a new PAT for MCP or API usage and returns the token secret exactly once.",
      tags: ["personal-access-tokens"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("CreatePersonalAccessTokenRequest", {
        name: "Rentify MCP",
        scopes: ["mcp:read", "mcp:write"],
        expiresInDays: 30,
      }),
      responses: {
        "201": successResponse(
          201,
          "Personal access token created successfully.",
          "CreatePersonalAccessTokenResult",
          personalAccessTokenCreateExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/auth/personal-access-tokens/:id",
      operationId: "revokePersonalAccessToken",
      summary: "Revoke a personal access token",
      description:
        "Revokes one of the current signed-in user's personal access tokens.",
      tags: ["personal-access-tokens"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Personal access token identifier.", "pat-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Personal access token revoked successfully.",
          "RevokePersonalAccessTokenResult",
          {
            revoked: true,
            tokenId: "pat-1",
          },
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/me",
      operationId: "listMyOrganizations",
      summary: "List the caller's organizations",
      description:
        "Returns organization memberships for the signed-in user together with the currently active organization summary.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationWorkspaceResult",
          organizationWorkspaceExample,
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/me/active",
      operationId: "setActiveOrganization",
      summary: "Set the active organization",
      description:
        "Stores the signed-in user's active organization preference when they belong to more than one organization.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("SetActiveOrganizationRequest", {
        organizationId: "org-1",
      }),
      responses: {
        "200": successResponse(
          200,
          "Active organization updated successfully.",
          "SetActiveOrganizationResult",
          {
            activeOrganization: organizationSummaryExample,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/invitations/:token",
      operationId: "previewOrganizationInvitation",
      summary: "Preview an organization invitation",
      description:
        "Loads organization invitation status and viewer eligibility details. Authentication is optional; when present it is used to show whether the current account can accept the invite.",
      tags: ["organizations"],
      security: optionalSecurity,
      permissions: {
        authMode: "optional-bearer",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam(
          "token",
          "Organization invitation token.",
          "invite_token_123",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationInvitePreviewResult",
          organizationInvitePreviewExample,
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/invitations/:token/accept",
      operationId: "acceptOrganizationInvitation",
      summary: "Accept an organization invitation",
      description:
        "Accepts a pending organization invitation for the authenticated user when the invite email matches the verified account email.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam(
          "token",
          "Organization invitation token.",
          "invite_token_123",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Organization invitation accepted successfully.",
          "AcceptOrganizationInviteResult",
          organizationInviteAcceptedExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id",
      operationId: "getOrganizationById",
      summary: "Get organization detail",
      description:
        "Returns organization profile, roster, and pending invitations for a member of the organization.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationDetailResult",
          organizationDetailExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/organizations/:id",
      operationId: "updateOrganization",
      summary: "Rename an organization",
      description:
        "Updates the organization name. Only the primary manager can rename the organization in this release.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("UpdateOrganizationRequest", {
        name: "Northwind Creative",
      }),
      responses: {
        "200": successResponse(
          200,
          "Organization updated successfully.",
          "OrganizationSummary",
          {
            ...organizationSummaryExample,
            name: "Northwind Creative",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/invitations",
      operationId: "createOrganizationInvitation",
      summary: "Create or reissue an organization invitation",
      description:
        "Creates a new invitation for the organization or reissues a pending invite for the same email.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("CreateOrganizationInvitationRequest", {
        email: "teammate@example.com",
        role: "operator",
      }),
      responses: {
        "201": successResponse(
          201,
          "Organization invitation created successfully.",
          "CreateOrganizationInviteResult",
          {
            invitation: organizationInviteExample,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/invitations/:inviteId",
      operationId: "revokeOrganizationInvitation",
      summary: "Revoke an organization invitation",
      description:
        "Revokes a pending organization invitation when the caller has sufficient organization permissions.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "inviteId",
          "Organization invitation identifier.",
          "invite-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Organization invitation revoked successfully.",
          "CreateOrganizationInviteResult",
          {
            invitation: {
              ...organizationInviteExample,
              status: "revoked",
              revokedAt: "2026-05-28T11:00:00.000Z",
            },
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/organizations/:id/members/:memberId",
      operationId: "updateOrganizationMember",
      summary: "Update an organization member role",
      description:
        "Changes the role of an existing organization member within the v1 role restrictions.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "memberId",
          "Organization membership identifier.",
          "membership-2",
        ),
      ],
      requestBody: requestBody("UpdateOrganizationMemberRequest", {
        role: "manager",
      }),
      responses: {
        "200": successResponse(
          200,
          "Organization member updated successfully.",
          "UpdateOrganizationMemberResult",
          {
            member: {
              ...organizationMemberExample,
              role: "manager",
            },
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/members/:memberId",
      operationId: "removeOrganizationMember",
      summary: "Remove an organization member",
      description:
        "Removes an organization membership when the caller has permission to manage that member role.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "memberId",
          "Organization membership identifier.",
          "membership-2",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Organization member removed successfully.",
          "RemoveOrganizationMemberResult",
          {
            removed: true,
            membershipId: "membership-2",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/blob/upload-url",
      operationId: "createBlobUploadUrl",
      summary: "Create an upload URL for blob storage",
      description:
        "Creates a short-lived signed upload target for authenticated users.",
      tags: ["blob"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("CreateBlobUploadUrlRequest", {
        filename: "loft.jpg",
        contentType: "image/jpeg",
        scope: "postings/photos",
      }),
      responses: {
        "201": successResponse(
          201,
          "Blob upload URL created successfully.",
          "BlobUploadTarget",
          blobUploadTargetExample,
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/blob/upload",
      operationId: "uploadLocalBlob",
      summary: "Upload a blob payload to the local development fallback",
      description:
        "Accepts a signed local-development upload URL generated by the blob upload target route. This route is only used when Azure Blob Storage is not configured in development.",
      tags: ["blob"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "blobName",
          { type: "string" },
          "Managed blob name to store.",
          "postings/user-1/local-photo.png",
          true,
        ),
        queryParam(
          "expiresAt",
          { type: "string", format: "date-time" },
          "Signed upload expiry timestamp.",
          "2026-05-31T18:15:00.000Z",
          true,
        ),
        queryParam(
          "token",
          { type: "string" },
          "Upload token generated by the blob upload target route.",
          "signed-local-upload-token",
          true,
        ),
      ],
      requestBody: {
        required: true,
        content: {
          "application/octet-stream": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
          "image/png": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
          "image/jpeg": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Blob uploaded successfully.",
        },
        ...commonErrors([400, 404, 415, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/blob/file",
      operationId: "getLocalBlob",
      summary: "Read a locally stored development blob",
      description:
        "Returns a blob payload from the local development fallback store. This route is only used when Azure Blob Storage is not configured in development.",
      tags: ["blob"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "blobName",
          { type: "string" },
          "Managed blob name to fetch.",
          "postings/user-1/local-photo.png",
          true,
        ),
      ],
      responses: {
        "200": {
          description: "Blob payload returned successfully.",
          content: {
            "application/octet-stream": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
            "image/png": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
            "image/jpeg": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
          },
        },
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/profiles",
      operationId: "listProfiles",
      summary: "List public profiles",
      description:
        "Returns public profile records with optional text search over usernames and names.",
      tags: ["profiles"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "q",
          { type: "string" },
          "Optional profile search query.",
          "tay",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ListProfilesResult",
          {
            profiles: [publicProfileExample],
            pagination: searchResultExample.pagination,
            query: "tay",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/profile/me",
      operationId: "getOwnProfile",
      summary: "Get the current user's profile",
      description:
        "Returns the full profile record for the authenticated user. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["profiles"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ProfileRecord",
          privateProfileExample,
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/profile/me",
      operationId: "updateOwnProfile",
      summary: "Update the current user's profile",
      description: "Updates the authenticated user's editable profile fields.",
      tags: ["profiles"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("UpdateProfileRequest", {
        username: "taylor-renter",
        phoneNumber: "+1 555 0100",
        isPrivate: false,
        recommendationPersonalizationEnabled: true,
        avatarUrl: "https://cdn.rentify.local/avatars/user-1.png",
      }),
      responses: {
        "200": successResponse(
          200,
          "Profile updated successfully.",
          "ProfileRecord",
          privateProfileExample,
        ),
        ...commonErrors([400, 401, 403, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/admin/search/reindex",
      operationId: "startSearchReindex",
      summary: "Start a search reindex run",
      description:
        "Starts a full postings search reindex. Admin bearer authentication is required.",
      tags: ["admin-search"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      responses: {
        "202": successResponse(
          202,
          "Search reindex has been started.",
          "SearchReindexRunRecord",
          searchStatusExample.currentReindexRun,
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/admin/search/reindex-runs/:id",
      operationId: "getSearchReindexRun",
      summary: "Get a search reindex run",
      description:
        "Returns the specified reindex run, or `run: null` if the identifier does not exist.",
      tags: ["admin-search"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Search reindex run identifier.", "reindex-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "SearchReindexRunLookupResult",
          {
            run: searchStatusExample.currentReindexRun,
          },
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/admin/search/status",
      operationId: "getSearchStatus",
      summary: "Get search subsystem status",
      description:
        "Returns alias status, queue lag, telemetry, and the latest/current reindex state.",
      tags: ["admin-search"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "SearchStatusResult",
          searchStatusExample,
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/admin/search/outbox/replay-dead-lettered",
      operationId: "replayDeadLetteredSearchOutbox",
      summary: "Replay dead-lettered search outbox entries",
      description:
        "Requeues dead-lettered search sync entries. The optional `limit` query controls how many items to revive.",
      tags: ["admin-search"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "limit",
          { type: "integer", minimum: 1, default: 100 },
          "Maximum number of dead-lettered entries to revive.",
          100,
        ),
      ],
      responses: {
        "202": successResponse(
          202,
          "Dead-lettered search outbox entries are being replayed.",
          "ReplayDeadLetteredSearchOutboxResult",
          {
            revived: 4,
          },
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/admin/search/cleanup-retained-indices",
      operationId: "cleanupRetainedSearchIndices",
      summary: "Delete retained search indices",
      description:
        "Deletes retained search indices that are no longer needed after reindex completion.",
      tags: ["admin-search"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      responses: {
        "202": successResponse(
          202,
          "Search index cleanup has been started.",
          "CleanupRetainedSearchIndicesResult",
          {
            deleted: 1,
          },
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/postings",
      operationId: "createPosting",
      summary: "Create a draft posting",
      description:
        "Creates a draft posting owned by the authenticated owner. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      requestBody: requestBody("UpsertPostingRequest", {
        name: "Sunny loft workspace",
        description: "Bright downtown loft with desks and meeting space.",
        pricing: postingExample.pricing,
        photos: [
          {
            blobUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
            blobName: "postings/posting-1/photo-1.jpg",
            position: 0,
          },
        ],
        tags: ["workspace", "wifi"],
        availabilityStatus: "available",
        availabilityNotes: "Best for weekday bookings.",
        maxBookingDurationDays: 30,
        location: postingExample.location,
        variant: postingExample.variant,
        details: postingExample.details,
        availabilityBlocks: [
          {
            startAt: "2026-06-10T00:00:00.000Z",
            endAt: "2026-06-12T00:00:00.000Z",
            note: "Owner maintenance",
          },
        ],
      }),
      responses: {
        "201": successResponse(
          201,
          "Posting draft created successfully.",
          "PostingRecord",
          postingExample,
        ),
        ...commonErrors([400, 401, 403, 409, 422, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/me",
      operationId: "listOwnPostings",
      summary: "List the authenticated owner's postings",
      description:
        "Returns the authenticated owner's postings with pagination and optional status filtering. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "status",
          {
            type: "string",
            enum: ["draft", "published", "paused", "archived"],
          },
          "Optional posting status filter.",
          "published",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ListOwnerPostingsResult",
          {
            postings: [postingExample],
            pagination: searchResultExample.pagination,
            status: "published",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/me/batch",
      operationId: "batchOwnPostings",
      summary: "Fetch multiple owner postings by ID",
      description:
        "Returns multiple owner postings by repeated or comma-separated `ids` query values. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        queryParam(
          "ids",
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          "Posting identifiers. Supports repeated `ids` or comma-separated values.",
          ["posting-1", "posting-2"],
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BatchOwnerPostingsResult",
          {
            postings: [postingExample],
            missingIds: ["posting-missing"],
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/postings/:id",
      operationId: "updatePosting",
      summary: "Update an owner posting",
      description:
        "Updates an existing owner posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("UpdatePostingRequest", {
        name: "Sunny loft workspace",
        description: "Updated description.",
        pricing: postingExample.pricing,
        photos: [
          {
            blobUrl: "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
            blobName: "postings/posting-1/photo-1.jpg",
            position: 0,
          },
        ],
        tags: ["workspace", "wifi"],
        availabilityStatus: "available",
        availabilityNotes: "Updated availability note.",
        maxBookingDurationDays: 21,
        location: postingExample.location,
        variant: postingExample.variant,
        details: postingExample.details,
      }),
      responses: {
        "200": successResponse(
          200,
          "Posting updated successfully.",
          "PostingRecord",
          postingExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 422, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/duplicate",
      operationId: "duplicatePosting",
      summary: "Duplicate an owner posting",
      description:
        "Creates a new draft posting by duplicating the selected owner posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "201": successResponse(
          201,
          "Posting duplicated successfully.",
          "PostingRecord",
          {
            ...postingExample,
            id: "posting-2",
            status: "draft",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/publish",
      operationId: "publishPosting",
      summary: "Publish an owner posting",
      description:
        "Publishes a draft or paused owner posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Posting published successfully.",
          "PostingRecord",
          postingExample,
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/pause",
      operationId: "pausePosting",
      summary: "Pause an owner posting",
      description:
        "Pauses a published posting without archiving it. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Posting paused successfully.",
          "PostingRecord",
          {
            ...postingExample,
            status: "paused",
            pausedAt: "2026-05-25T16:00:00.000Z",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/unpause",
      operationId: "unpausePosting",
      summary: "Unpause an owner posting",
      description:
        "Moves a paused posting back to a published state. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Posting unpaused successfully.",
          "PostingRecord",
          postingExample,
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/archive",
      operationId: "archivePosting",
      summary: "Archive an owner posting",
      description:
        "Archives a posting so it is no longer bookable or publicly visible. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Posting archived successfully.",
          "PostingRecord",
          {
            ...postingExample,
            status: "archived",
            archivedAt: "2026-05-25T17:00:00.000Z",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/analytics/summary",
      operationId: "getPostingAnalyticsSummary",
      summary: "Get owner analytics summary",
      description:
        "Returns owner-level analytics totals for the selected reporting window. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        queryParam(
          "window",
          { type: "string", enum: ["7d", "30d", "all"], default: "7d" },
          "Reporting window.",
          "7d",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OwnerPostingsAnalyticsSummary",
          analyticsSummaryExample,
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/analytics/postings",
      operationId: "listPostingAnalytics",
      summary: "List posting analytics by posting",
      description:
        "Returns paginated posting analytics rows for the authenticated owner. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "window",
          { type: "string", enum: ["7d", "30d", "all"], default: "7d" },
          "Reporting window.",
          "7d",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PostingAnalyticsListResult",
          {
            window: "7d",
            postings: [
              {
                postingId: "posting-1",
                name: "Sunny loft workspace",
                status: "published",
                primaryPhotoUrl:
                  "https://cdn.rentify.local/postings/posting-1/photo-1.jpg",
                totals: analyticsSummaryExample.totals,
                derivedMetrics: analyticsSummaryExample.derivedMetrics,
              },
            ],
            pagination: searchResultExample.pagination,
            dataAvailability: analyticsSummaryExample.dataAvailability,
            range: analyticsSummaryExample.range,
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/:id/analytics",
      operationId: "getPostingAnalyticsDetail",
      summary: "Get analytics for a single posting",
      description:
        "Returns detailed analytics buckets for a single owner posting. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        queryParam(
          "window",
          { type: "string", enum: ["7d", "30d", "all"], default: "7d" },
          "Reporting window.",
          "7d",
        ),
        queryParam(
          "granularity",
          { type: "string", enum: ["hour", "day"], default: "day" },
          "Bucket granularity.",
          "day",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PostingAnalyticsDetail",
          analyticsDetailExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/:id/reviews",
      operationId: "listPostingReviews",
      summary: "List reviews for a posting",
      description:
        "Returns public reviews for the selected posting with pagination and rating summary.",
      tags: ["postings"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        parameterRef("Page"),
        parameterRef("PageSize"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ListPostingReviewsResult",
          {
            reviews: [reviewExample],
            summary: {
              averageRating: 4.8,
              reviewCount: 12,
            },
            pagination: searchResultExample.pagination,
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/reviews",
      operationId: "createPostingReview",
      summary: "Create a review for a posting",
      description:
        "Creates a review for a posting as an authenticated renter. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("CreatePostingReviewRequest", {
        rating: 5,
        title: "Great space",
        comment: "Exactly as advertised and easy to book.",
      }),
      responses: {
        "201": successResponse(
          201,
          "Review created successfully.",
          "PostingReviewRecord",
          reviewExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/postings/:id/reviews/me",
      operationId: "updateOwnPostingReview",
      summary: "Update the caller's review for a posting",
      description:
        "Updates the authenticated user's own review for a posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("CreatePostingReviewRequest", {
        rating: 4,
        title: "Still good",
        comment: "Updating my review after a second stay.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Review updated successfully.",
          "PostingReviewRecord",
          {
            ...reviewExample,
            rating: 4,
            title: "Still good",
            comment: "Updating my review after a second stay.",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/feedback",
      operationId: "createAppFeedback",
      summary: "Submit app feedback",
      description:
        "Creates an app feedback submission. Anonymous callers must include a valid `captchaToken`; signed-in callers may submit without captcha and will have their session user context attached automatically.",
      tags: ["feedback"],
      permissions: {
        authMode: "public-or-session-bearer",
        minimumRole: null,
        patAllowed: false,
        captcha: "Required for anonymous callers only.",
      },
      requestBody: requestBody(
        "CreateAppFeedbackRequest",
        {
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "feature_request",
          message:
            "A saved-search shortcut on the contact or home experience would make it easier to return to promising rentals.",
          captchaToken: "turnstile-token",
        },
        "Feedback submission payload. `captchaToken` is required only when the request is anonymous.",
      ),
      responses: {
        "201": successResponse(
          201,
          "Feedback submitted successfully.",
          "AppFeedbackSubmissionReceipt",
          feedbackReceiptExample,
        ),
        ...commonErrors([400, 401, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/reports",
      operationId: "createReport",
      summary: "Create a misconduct report",
      description:
        "Creates a content report for a posting, posting review, or user. Browser bearer authentication is required.",
      tags: ["moderation"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("CreateReportRequest", {
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "fraud_or_scam",
        title: "Payment requested off-platform",
        description:
          "The listing description asks renters to contact a private number and pay by wire transfer.",
      }),
      responses: {
        "201": successResponse(
          201,
          "Report created successfully.",
          "ContentReportRecord",
          reportExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/moderation/reports",
      operationId: "listModerationReports",
      summary: "List moderation reports",
      description:
        "Returns the moderator report queue with filters, pagination, and source metadata.",
      tags: ["moderation"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "moderator",
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "q",
          { type: "string" },
          "Full-text moderator search query.",
        ),
        queryParam(
          "status",
          {
            type: "string",
            enum: ["open", "under_review", "resolved", "dismissed"],
          },
          "Filter by report status.",
        ),
        queryParam(
          "subjectType",
          {
            type: "string",
            enum: ["posting", "posting_review", "user"],
          },
          "Filter by report subject type.",
        ),
        queryParam(
          "reasonCode",
          {
            type: "string",
            enum: [
              "spam",
              "fraud_or_scam",
              "harassment_or_hate",
              "sexual_content",
              "violence_or_threats",
              "illegal_or_prohibited",
              "impersonation",
              "misleading_information",
              "review_manipulation",
              "other",
            ],
          },
          "Filter by report reason.",
        ),
        queryParam(
          "assignedTo",
          { type: "string" },
          "Filter by assigned moderator ID or use `unassigned`.",
        ),
        queryParam(
          "reporterId",
          { type: "string" },
          "Filter by reporter user ID.",
        ),
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "sort",
          {
            type: "string",
            enum: ["newest", "oldest", "recentlyReviewed"],
            default: "newest",
          },
          "Queue sort order.",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ListContentReportsResult",
          reportsListExample,
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
            source: "elasticsearch",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/moderation/reports/:id",
      operationId: "getModerationReport",
      summary: "Get a moderation report",
      description:
        "Returns a single report with its subject snapshot and event timeline.",
      tags: ["moderation"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "moderator",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Report identifier.", "report-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ContentReportDetailRecord",
          reportDetailExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/moderation/reports/:id/assignment",
      operationId: "assignModerationReport",
      summary: "Assign or unassign a report",
      description:
        "Assigns a moderation report to the current moderator, clears the assignment, or lets admins assign another moderator.",
      tags: ["moderation"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "moderator",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Report identifier.", "report-1")],
      requestBody: requestBody("AssignContentReportRequest", {
        assignedModeratorId: "moderator-1",
      }),
      responses: {
        "200": successResponse(
          200,
          "Report assignment updated successfully.",
          "ContentReportRecord",
          reportExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/moderation/reports/:id/status",
      operationId: "updateModerationReportStatus",
      summary: "Update moderation report status",
      description:
        "Moves a report through moderation review states and optionally records a resolution and note.",
      tags: ["moderation"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "moderator",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Report identifier.", "report-1")],
      requestBody: requestBody("UpdateContentReportStatusRequest", {
        status: "resolved",
        resolutionCode: "action_taken",
        resolutionSummary: "Listing removed after moderator review.",
        note: "Reporter and listing snapshot reviewed.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Report status updated successfully.",
          "ContentReportRecord",
          {
            ...reportExample,
            status: "resolved",
            resolutionCode: "action_taken",
            resolutionSummary: "Listing removed after moderator review.",
            reviewedAt: "2026-05-25T16:00:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/:id/availability-blocks",
      operationId: "listPostingAvailabilityBlocks",
      summary: "List owner availability blocks",
      description:
        "Returns owner-managed availability blocks for the selected posting. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "AvailabilityBlockListResult",
          {
            availabilityBlocks: postingExample.availabilityBlocks,
          },
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/availability-blocks",
      operationId: "createPostingAvailabilityBlock",
      summary: "Create an availability block",
      description:
        "Creates an owner-managed availability block for the selected posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("OwnerAvailabilityBlockRequest", {
        startAt: "2026-06-10T00:00:00.000Z",
        endAt: "2026-06-12T00:00:00.000Z",
        note: "Owner maintenance",
      }),
      responses: {
        "201": successResponse(
          201,
          "Availability block created successfully.",
          "PostingAvailabilityBlockRecord",
          postingExample.availabilityBlocks[0],
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/postings/:id/availability-blocks/:blockId",
      operationId: "updatePostingAvailabilityBlock",
      summary: "Update an availability block",
      description:
        "Updates an owner-managed availability block for the selected posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        routePathParam("blockId", "Availability block identifier.", "block-1"),
      ],
      requestBody: requestBody("OwnerAvailabilityBlockRequest", {
        startAt: "2026-06-11T00:00:00.000Z",
        endAt: "2026-06-13T00:00:00.000Z",
        note: "Updated owner maintenance window",
      }),
      responses: {
        "200": successResponse(
          200,
          "Availability block updated successfully.",
          "PostingAvailabilityBlockRecord",
          {
            ...(postingExample.availabilityBlocks[0] as Record<
              string,
              unknown
            >),
            startAt: "2026-06-11T00:00:00.000Z",
            endAt: "2026-06-13T00:00:00.000Z",
            note: "Updated owner maintenance window",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/postings/:id/availability-blocks/:blockId",
      operationId: "deletePostingAvailabilityBlock",
      summary: "Delete an availability block",
      description:
        "Deletes an owner-managed availability block for the selected posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        routePathParam("blockId", "Availability block identifier.", "block-1"),
      ],
      responses: {
        "204": noContentResponse("Availability block deleted successfully."),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/activity/search-click",
      operationId: "trackPostingSearchClick",
      summary: "Track a search-result click for a posting",
      description:
        "Records a search click for recommendations and analytics. Authentication is optional; PAT bearer authentication with `mcp:read` is allowed when supplied.",
      tags: ["postings"],
      security: optionalSecurity,
      permissions: {
        authMode: "optional-bearer",
        minimumRole: null,
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("SearchClickActivityRequest", {
        searchSessionId: "search-session-1",
        query: "loft",
        family: "place",
        subtype: "workspace",
        page: 1,
        position: 0,
        hasGeoFilter: true,
        hasAvailabilityFilter: false,
      }),
      responses: {
        "202": successResponse(
          202,
          "Posting search click tracked successfully.",
          "AcceptedActionResult",
          actionAcceptedExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings",
      operationId: "searchPostings",
      summary: "Search public postings",
      description:
        "Searches public postings with optional text, category, pricing, geo, availability, and dynamic `attr.<key>` attribute filters. JSON is the default output format; XML is also available with `?format=xml` or `Accept: application/xml`.",
      tags: ["postings"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "q",
          { type: "string", maxLength: 120 },
          "Text query.",
          "loft",
        ),
        queryParam(
          "family",
          { type: "string", enum: ["place", "equipment", "vehicle"] },
          "Posting family filter.",
          "place",
        ),
        queryParam(
          "subtype",
          { type: "string" },
          "Posting subtype filter.",
          "workspace",
        ),
        queryParam(
          "tags",
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          "Tag filter. Supports repeated `tags` values or comma-separated values.",
          ["workspace", "wifi"],
        ),
        queryParam(
          "availabilityStatus",
          { type: "string", enum: ["available", "limited", "unavailable"] },
          "Availability status filter.",
          "available",
        ),
        queryParam(
          "minDailyPrice",
          { type: "number", minimum: 0 },
          "Minimum daily price.",
          50,
        ),
        queryParam(
          "maxDailyPrice",
          { type: "number", minimum: 0 },
          "Maximum daily price.",
          250,
        ),
        queryParam(
          "latitude",
          { type: "number", minimum: -90, maximum: 90 },
          "Latitude.",
          43.65,
        ),
        queryParam(
          "longitude",
          { type: "number", minimum: -180, maximum: 180 },
          "Longitude.",
          -79.38,
        ),
        queryParam(
          "radiusKm",
          { type: "number", minimum: 0 },
          "Radius in kilometers.",
          10,
        ),
        queryParam(
          "startAt",
          { type: "string", format: "date-time" },
          "Availability window start. Must be paired with `endAt`.",
          "2026-06-14T15:00:00.000Z",
        ),
        queryParam(
          "endAt",
          { type: "string", format: "date-time" },
          "Availability window end. Must be paired with `startAt`.",
          "2026-06-17T11:00:00.000Z",
        ),
        queryParam(
          "sort",
          {
            type: "string",
            enum: [
              "relevance",
              "newest",
              "oldest",
              "dailyPrice",
              "nearest",
              "nameAsc",
              "nameDesc",
            ],
            default: "relevance",
          },
          "Sort order.",
          "relevance",
        ),
        queryParam(
          "attr.<attributeKey>",
          {
            oneOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
            ],
          },
          "Dynamic attribute filter, for example `attr.guest_capacity=4` or `attr.weight_lb.min=10`.",
          "4",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "SearchPostingsResult",
          searchResultExample,
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
            source: "elasticsearch",
          },
        ),
        ...commonErrors([400, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/postings/autocomplete",
      operationId: "autocompletePostings",
      summary: "Autocomplete public postings",
      description:
        "Returns autocomplete suggestions for posting names, tags, and locations.",
      tags: ["postings"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "q",
          { type: "string", minLength: 2, maxLength: 120 },
          "Autocomplete query.",
          "lo",
        ),
        queryParam(
          "family",
          { type: "string", enum: ["place", "equipment", "vehicle"] },
          "Optional family filter.",
          "place",
        ),
        queryParam(
          "subtype",
          { type: "string" },
          "Optional subtype filter.",
          "workspace",
        ),
        queryParam(
          "limit",
          { type: "integer", minimum: 1, maximum: 8, default: 6 },
          "Maximum number of suggestions.",
          6,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PostingAutocompleteResult",
          autocompleteExample,
        ),
        ...commonErrors([400, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/postings/recommendations",
      operationId: "listRecommendations",
      summary: "List recommended postings",
      description:
        "Returns personalized or fallback popular recommendations. Authentication is optional; when present it improves personalization.",
      tags: ["postings"],
      security: optionalSecurity,
      permissions: {
        authMode: "optional-bearer",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "family",
          { type: "string", enum: ["place", "equipment", "vehicle"] },
          "Optional family filter.",
          "place",
        ),
        queryParam(
          "subtype",
          { type: "string" },
          "Optional subtype filter.",
          "workspace",
        ),
        queryParam(
          "latitude",
          { type: "number" },
          "Latitude for geo filtering.",
          43.65,
        ),
        queryParam(
          "longitude",
          { type: "number" },
          "Longitude for geo filtering.",
          -79.38,
        ),
        queryParam(
          "radiusKm",
          { type: "number", minimum: 0 },
          "Geo radius.",
          10,
        ),
        queryParam(
          "startAt",
          { type: "string", format: "date-time" },
          "Availability window start.",
          "2026-06-14T15:00:00.000Z",
        ),
        queryParam(
          "endAt",
          { type: "string", format: "date-time" },
          "Availability window end.",
          "2026-06-17T11:00:00.000Z",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "RecommendationQueryResult",
          recommendationExample,
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: recommendationExample.pagination,
            mode: "personalized",
            fallback: false,
            snapshotGeneratedAt: "2026-05-25T14:00:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/postings/batch",
      operationId: "batchPublicPostings",
      summary: "Fetch multiple public postings by ID",
      description:
        "Returns multiple public postings by repeated or comma-separated `ids` query values.",
      tags: ["postings"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "ids",
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          "Posting identifiers. Supports repeated `ids` or comma-separated values.",
          ["posting-1", "posting-2"],
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BatchPublicPostingsResult",
          {
            postings: [postingExample],
            missingIds: ["posting-missing"],
          },
        ),
        ...commonErrors([400, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/:id",
      operationId: "getPostingById",
      summary: "Get a public posting by ID",
      description:
        "Returns a public posting record. Authentication is optional; if the viewer is not the owner, the request also records view analytics and recommendation activity.",
      tags: ["postings"],
      security: optionalSecurity,
      permissions: {
        authMode: "optional-bearer",
        minimumRole: null,
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PublicPostingRecord",
          postingExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/booking-requests",
      operationId: "createBookingRequest",
      summary: "Create a booking request for a posting",
      description:
        "Creates a booking request for the selected posting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("CreateBookingRequest", {
        startAt: "2026-06-14T15:00:00.000Z",
        endAt: "2026-06-17T11:00:00.000Z",
        guestCount: 2,
        note: "Need reliable Wi-Fi for a client workshop.",
        contactName: "Taylor Renter",
        contactEmail: "user1@rentify.local",
        contactPhoneNumber: "+1 555 0100",
      }),
      responses: {
        "201": successResponse(
          201,
          "Booking request created successfully.",
          "BookingRequestRecord",
          bookingRequestExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 422, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/booking-quote",
      operationId: "quoteBookingRequest",
      summary: "Quote a potential booking request",
      description:
        "Returns bookability and pricing information for a potential booking request without creating it. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("BookingQuoteRequest", {
        startAt: "2026-06-14T15:00:00.000Z",
        endAt: "2026-06-17T11:00:00.000Z",
        guestCount: 2,
        note: "Need reliable Wi-Fi for a client workshop.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingQuoteResult",
          bookingQuoteExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 422, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/postings/:id/booking-requests",
      operationId: "listPostingBookingRequests",
      summary: "List booking requests for an owner posting",
      description:
        "Returns booking requests for a specific owner posting. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "status",
          {
            type: "string",
            enum: [
              "pending",
              "approved",
              "awaiting_payment",
              "payment_processing",
              "paid",
              "payment_failed",
              "declined",
              "expired",
              "cancelled",
              "refunded",
            ],
          },
          "Optional booking request status filter.",
          "pending",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingRequestsListResult",
          {
            bookingRequests: [bookingRequestExample],
            pagination: searchResultExample.pagination,
            status: "approved",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/booking-requests/me",
      operationId: "listOwnBookingRequests",
      summary: "List the caller's booking requests",
      description:
        "Returns booking requests created by the authenticated renter. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "status",
          {
            type: "string",
            enum: [
              "pending",
              "approved",
              "awaiting_payment",
              "payment_processing",
              "paid",
              "payment_failed",
              "declined",
              "expired",
              "cancelled",
              "refunded",
            ],
          },
          "Optional booking request status filter.",
          "approved",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingRequestsListResult",
          {
            bookingRequests: [bookingRequestExample],
            pagination: searchResultExample.pagination,
            status: "approved",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/booking-requests/owner",
      operationId: "listOwnedBookingRequests",
      summary: "List booking requests across the caller's postings",
      description:
        "Returns booking requests across all postings owned by the authenticated owner. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "status",
          {
            type: "string",
            enum: [
              "pending",
              "approved",
              "awaiting_payment",
              "payment_processing",
              "paid",
              "payment_failed",
              "declined",
              "expired",
              "cancelled",
              "refunded",
            ],
          },
          "Optional booking request status filter.",
          "pending",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingRequestsListResult",
          {
            bookingRequests: [bookingRequestExample],
            pagination: searchResultExample.pagination,
            status: "pending",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/booking-requests/me/dashboard",
      operationId: "getRenterBookingDashboard",
      summary: "Get the renter booking dashboard",
      description:
        "Returns renter dashboard buckets, next actions, and pagination. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "sort",
          { type: "string", enum: ["urgency", "start_at"], default: "urgency" },
          "Dashboard sort.",
          "urgency",
        ),
        queryParam(
          "bucket",
          {
            type: "string",
            enum: [
              "action_needed",
              "upcoming",
              "active",
              "pending",
              "past",
              "cancelled",
            ],
          },
          "Optional renter dashboard bucket filter.",
          "action_needed",
        ),
        queryParam(
          "status",
          { type: "string" },
          "Optional booking request status filter.",
          "approved",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "RenterBookingDashboardResult",
          {
            summary: {
              upcoming: 1,
              active: 0,
              pending: 2,
              actionNeeded: 1,
              past: 4,
              cancelled: 1,
            },
            items: [
              {
                id: "booking-1",
                kind: "booking_request",
                bookingRequestId: "booking-1",
                postingId: "posting-1",
                renterId: "user-1",
                organizationId: "org-1",
                status: "approved",
                sourceStatus: "approved",
                startAt: bookingRequestExample.startAt,
                endAt: bookingRequestExample.endAt,
                durationDays: 3,
                guestCount: 2,
                pricingCurrency: "CAD",
                dailyPriceAmount: 150,
                estimatedTotal: 450,
                createdAt: bookingRequestExample.createdAt,
                updatedAt: bookingRequestExample.updatedAt,
                posting: bookingRequestExample.posting,
                holdExpiresAt: bookingRequestExample.holdExpiresAt,
                approvedAt: bookingRequestExample.approvedAt,
                isExpiringHold: false,
                nextAction: {
                  code: "complete_payment",
                  label: "Complete payment",
                },
                urgency: {
                  level: "high",
                  rank: 1,
                  isActionable: true,
                  label: "Action needed",
                  deadlineAt: bookingRequestExample.holdExpiresAt,
                },
              },
            ],
            pagination: searchResultExample.pagination,
            filters: {
              page: 1,
              pageSize: 20,
              sort: "urgency",
              bucket: "action_needed",
            },
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/booking-requests/owner/dashboard",
      operationId: "getOwnerBookingDashboard",
      summary: "Get the owner booking dashboard",
      description:
        "Returns owner dashboard items, summary, and posting filters. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "sort",
          { type: "string", enum: ["urgency", "start_at"], default: "urgency" },
          "Dashboard sort.",
          "urgency",
        ),
        queryParam(
          "status",
          { type: "string" },
          "Optional booking status filter.",
          "pending",
        ),
        queryParam(
          "actionNeeded",
          {
            type: "string",
            enum: [
              "approval",
              "payment",
              "expiring_hold",
              "payment_failure",
              "conversion",
            ],
          },
          "Optional owner action-needed filter.",
          "approval",
        ),
        queryParam(
          "postingId",
          { type: "string" },
          "Optional posting identifier filter.",
          "posting-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OwnerBookingDashboardResult",
          {
            summary: {
              approval: 1,
              payment: 1,
              expiringHold: 0,
              paymentFailure: 0,
              conversion: 0,
              upcomingRentings: 1,
              activeRentings: 0,
              pastRentings: 4,
              totalOpen: 2,
            },
            items: [
              {
                id: "booking-1",
                kind: "booking_request",
                bookingRequestId: "booking-1",
                postingId: "posting-1",
                renterId: "user-1",
                organizationId: "org-1",
                status: "pending",
                sourceStatus: "pending",
                startAt: bookingRequestExample.startAt,
                endAt: bookingRequestExample.endAt,
                durationDays: 3,
                guestCount: 2,
                pricingCurrency: "CAD",
                dailyPriceAmount: 150,
                estimatedTotal: 450,
                createdAt: bookingRequestExample.createdAt,
                updatedAt: bookingRequestExample.updatedAt,
                posting: bookingRequestExample.posting,
                isExpiringHold: false,
                actionNeededCategory: "approval",
                nextAction: {
                  code: "review_request",
                  label: "Review request",
                },
                urgency: {
                  level: "high",
                  rank: 1,
                  isActionable: true,
                  label: "Awaiting owner decision",
                },
              },
            ],
            postings: [
              {
                id: "posting-1",
                name: "Sunny loft workspace",
              },
            ],
            pagination: searchResultExample.pagination,
            filters: {
              page: 1,
              pageSize: 20,
              sort: "urgency",
              actionNeeded: "approval",
            },
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/booking-requests/:id",
      operationId: "getBookingRequestById",
      summary: "Get a booking request by ID",
      description:
        "Returns a booking request when the authenticated caller is allowed to access it. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingRequestRecord",
          bookingRequestExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/booking-requests/:id/cancellation-quote",
      operationId: "getBookingCancellationQuote",
      summary: "Get a cancellation quote for a booking request",
      description:
        "Returns cancellation eligibility and refund details for a booking request. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingCancellationQuoteResult",
          bookingCancellationQuoteExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/booking-requests/:id",
      operationId: "updateOwnBookingRequest",
      summary: "Update the caller's pending booking request",
      description:
        "Updates the authenticated renter's own pending booking request. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      requestBody: requestBody("CreateBookingRequest", {
        startAt: "2026-06-15T15:00:00.000Z",
        endAt: "2026-06-18T11:00:00.000Z",
        guestCount: 2,
        note: "Updated request note.",
        contactName: "Taylor Renter",
        contactEmail: "user1@rentify.local",
        contactPhoneNumber: "+1 555 0100",
      }),
      responses: {
        "200": successResponse(
          200,
          "Booking request updated successfully.",
          "BookingRequestRecord",
          {
            ...bookingRequestExample,
            startAt: "2026-06-15T15:00:00.000Z",
            endAt: "2026-06-18T11:00:00.000Z",
            note: "Updated request note.",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 422, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/approve",
      operationId: "approveBookingRequest",
      summary: "Approve a booking request",
      description:
        "Approves a booking request as the posting owner. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      requestBody: requestBody("BookingDecisionRequest", {
        note: "Approved for the requested dates.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Booking request approved successfully.",
          "BookingRequestRecord",
          bookingRequestExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/decline",
      operationId: "declineBookingRequest",
      summary: "Decline a booking request",
      description:
        "Declines a booking request as the posting owner. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      requestBody: requestBody("BookingDecisionRequest", {
        note: "Dates are no longer available.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Booking request declined successfully.",
          "BookingRequestRecord",
          {
            ...bookingRequestExample,
            status: "declined",
            decisionNote: "Dates are no longer available.",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/cancel",
      operationId: "cancelBookingRequest",
      summary: "Cancel a booking request",
      description:
        "Cancels a booking request as an authorized participant. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      requestBody: requestBody("CancelBookingRequest", {
        reason: "Trip dates changed.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Booking request cancelled successfully.",
          "BookingRequestRecord",
          {
            ...bookingRequestExample,
            status: "cancelled",
            cancellationReason: "Trip dates changed.",
            cancelledAt: "2026-05-26T08:00:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/payment-session",
      operationId: "createPaymentSession",
      summary: "Create a payment session for a booking request",
      description:
        "Creates a Square payment session for an approved booking request. PAT bearer authentication is not allowed on payment-session routes.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        idempotency:
          "Uses `idempotency-key` or `x-idempotency-key`; falls back to request ID.",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      requestBody: requestBody("IdempotentMutationRequest", {
        idempotencyKey: "payment-session-1",
      }),
      responses: {
        "201": successResponse(
          201,
          "Payment session created successfully.",
          "PaymentRecord",
          paymentExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/payments/webhooks/square",
      operationId: "handleSquareWebhook",
      summary: "Handle a Square payment webhook",
      description:
        "Processes a Square webhook event. The `x-square-hmacsha256-signature` header is required and verified against the raw request body.",
      tags: ["payments"],
      security: [{ squareWebhookSignature: [] }],
      permissions: {
        authMode: "webhook-signature",
        minimumRole: null,
        patAllowed: false,
      },
      requestBody: {
        required: true,
        description: "Square webhook event payload.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: true,
            },
            example: {
              merchant_id: "merchant-1",
              type: "payment.updated",
              data: {
                object: {
                  payment: {
                    id: "sq-payment-1",
                    order_id: "sq-order-1",
                    status: "COMPLETED",
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": successResponse(
          200,
          "Payment webhook processed successfully.",
          "ActionOkResult",
          actionOkExample,
        ),
        ...commonErrors([400, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/payments/:id",
      operationId: "getPaymentById",
      summary: "Get a payment by ID",
      description:
        "Returns a payment record when the authenticated caller is allowed to access it.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Payment identifier.", "payment-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PaymentRecord",
          paymentExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/payments/:id/retry",
      operationId: "retryPayment",
      summary: "Retry a failed payment",
      description:
        "Retries payment session creation for a payment that can be retried. PAT bearer authentication is not allowed.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        idempotency:
          "Uses `idempotency-key` or `x-idempotency-key`; falls back to request ID.",
      },
      parameters: [routePathParam("id", "Payment identifier.", "payment-1")],
      requestBody: requestBody("IdempotentMutationRequest", {
        idempotencyKey: "payment-retry-1",
      }),
      responses: {
        "200": successResponse(
          200,
          "Payment retry requested successfully.",
          "PaymentRecord",
          paymentExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/payments/:id/refunds",
      operationId: "createPaymentRefund",
      summary: "Create a payment refund",
      description:
        "Creates a refund for an accessible payment. PAT bearer authentication is not allowed.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        idempotency:
          "Uses `idempotency-key` or `x-idempotency-key`; falls back to request ID.",
      },
      parameters: [routePathParam("id", "Payment identifier.", "payment-1")],
      requestBody: requestBody("CreateRefundRequest", {
        amount: 100,
        reason: "Partial inconvenience refund",
        idempotencyKey: "refund-1",
      }),
      responses: {
        "201": successResponse(
          201,
          "Refund created successfully.",
          "PaymentRecord",
          {
            ...paymentExample,
            status: "partially_refunded",
            refunds: [
              {
                id: "refund-1",
                paymentId: "payment-1",
                status: "succeeded",
                amount: 100,
                reason: "Partial inconvenience refund",
                idempotencyKey: "refund-1",
                squareRefundId: "sq-refund-1",
                createdAt: "2026-05-26T10:00:00.000Z",
                updatedAt: "2026-05-26T10:00:00.000Z",
                completedAt: "2026-05-26T10:00:00.000Z",
              },
            ],
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/payments/:id/reconcile",
      operationId: "reconcilePayment",
      summary: "Reconcile a payment with the provider",
      description:
        "Refreshes payment state from the provider and reconciles any required changes. PAT bearer authentication is not allowed.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Payment identifier.", "payment-1")],
      responses: {
        "200": successResponse(
          200,
          "Payment reconciled successfully.",
          "PaymentRecord",
          {
            ...paymentExample,
            status: "succeeded",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500, 503]),
      },
    },
    {
      method: "post",
      path: "/payments/:id/repair",
      operationId: "repairPayment",
      summary: "Queue an admin payment repair",
      description:
        "Queues an administrative payment repair task. Admin bearer authentication is required.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Payment identifier.", "payment-1")],
      responses: {
        "200": successResponse(
          200,
          "Payment repair queued successfully.",
          "ActionOkResult",
          actionOkExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/payouts/me",
      operationId: "listPayouts",
      summary: "List the caller's payouts",
      description:
        "Returns payouts for the authenticated owner. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "status",
          { type: "string", enum: ["scheduled", "released", "failed"] },
          "Optional payout status filter.",
          "scheduled",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PayoutListResult",
          {
            payouts: [payoutExample],
            pagination: searchResultExample.pagination,
            status: "scheduled",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/convert",
      operationId: "convertBookingRequestToRenting",
      summary: "Convert an approved booking request into a renting",
      description:
        "Creates a renting from an approved booking request. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      responses: {
        "201": successResponse(
          201,
          "Booking request converted to renting successfully.",
          "RentingRecord",
          rentingExample,
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/rentings/me",
      operationId: "listOwnRentings",
      summary: "List the caller's rentings",
      description:
        "Returns rentings accessible to the authenticated user. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [
        parameterRef("Page"),
        parameterRef("PageSize"),
        queryParam(
          "status",
          {
            type: "string",
            enum: [
              "confirmed",
              "check_in_ready",
              "active",
              "return_due",
              "completed",
              "disputed",
              "cancelled",
            ],
          },
          "Optional renting status filter.",
          "confirmed",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ListRentingsResult",
          {
            rentings: [rentingExample],
            pagination: searchResultExample.pagination,
            status: "confirmed",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: searchResultExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/rentings/:id/instructions",
      operationId: "updateRentingInstructions",
      summary: "Update renting instructions",
      description:
        "Updates pickup and return instructions for a renting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Renting identifier.", "renting-1")],
      requestBody: requestBody("UpdateRentingInstructionsRequest", {
        pickupInstructions: "Front desk will release the keys after ID check.",
        returnInstructions: "Leave keys in the lockbox by checkout.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Renting instructions updated successfully.",
          "RentingRecord",
          rentingExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/rentings/:id/check-in-ready",
      operationId: "markRentingCheckInReady",
      summary: "Mark a renting as check-in ready",
      description:
        "Marks a renting as ready for check-in. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Renting identifier.", "renting-1")],
      responses: {
        "200": successResponse(
          200,
          "Renting marked as check-in ready successfully.",
          "RentingRecord",
          {
            ...rentingExample,
            status: "check_in_ready",
            checkInReadyAt: "2026-06-14T14:30:00.000Z",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/rentings/:id/check-in",
      operationId: "markRentingCheckInComplete",
      summary: "Complete renting check-in",
      description:
        "Marks a renting as checked in and active. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Renting identifier.", "renting-1")],
      responses: {
        "200": successResponse(
          200,
          "Renting check-in completed successfully.",
          "RentingRecord",
          {
            ...rentingExample,
            status: "active",
            checkInCompletedAt: "2026-06-14T15:05:00.000Z",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/rentings/:id/return",
      operationId: "markRentingCompleted",
      summary: "Complete a renting return",
      description:
        "Marks a renting as returned and completed. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Renting identifier.", "renting-1")],
      responses: {
        "200": successResponse(
          200,
          "Renting return completed successfully.",
          "RentingRecord",
          {
            ...rentingExample,
            status: "completed",
            completedAt: "2026-06-17T11:05:00.000Z",
          },
        ),
        ...commonErrors([401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/rentings/:id/disputes",
      operationId: "createRentingDispute",
      summary: "Open a renting dispute",
      description:
        "Creates a dispute for the selected renting. PAT bearer authentication with `mcp:write` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:write",
      },
      parameters: [routePathParam("id", "Renting identifier.", "renting-1")],
      requestBody: requestBody("CreateRentingDisputeRequest", {
        reason: "Workspace was not accessible on arrival.",
        details:
          "The building concierge could not find the reservation details.",
      }),
      responses: {
        "201": successResponse(
          201,
          "Renting dispute opened successfully.",
          "RentingRecord",
          {
            ...rentingExample,
            status: "disputed",
            dispute: {
              id: "dispute-1",
              rentingId: "renting-1",
              openedByUserId: "user-1",
              reason: "Workspace was not accessible on arrival.",
              details:
                "The building concierge could not find the reservation details.",
              createdAt: "2026-06-14T16:00:00.000Z",
              updatedAt: "2026-06-14T16:00:00.000Z",
            },
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/rentings/:id",
      operationId: "getRentingById",
      summary: "Get a renting by ID",
      description:
        "Returns a renting when the authenticated caller is allowed to access it. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["rentings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [routePathParam("id", "Renting identifier.", "renting-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "RentingRecord",
          rentingExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
  ];
}

function buildDocumentPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of buildOperations()) {
    const normalizedPath = operation.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

    if (!paths[normalizedPath]) {
      paths[normalizedPath] = {};
    }

    paths[normalizedPath][operation.method] = {
      operationId: operation.operationId,
      summary: operation.summary,
      description: operation.description,
      tags: operation.tags,
      ...(operation.security ? { security: operation.security } : {}),
      "x-rentify-permissions": operation.permissions,
      ...(operation.parameters ? { parameters: operation.parameters } : {}),
      ...(operation.requestBody ? { requestBody: operation.requestBody } : {}),
      responses: operation.responses,
    };
  }

  return paths;
}

function buildComponents(): Record<string, unknown> {
  return {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT or Rentify PAT",
      },
      refreshTokenCookie: {
        type: "apiKey",
        in: "cookie",
        name: "refresh_token",
      },
      csrfHeader: {
        type: "apiKey",
        in: "header",
        name: "x-csrf-token",
      },
      squareWebhookSignature: {
        type: "apiKey",
        in: "header",
        name: "x-square-hmacsha256-signature",
      },
    },
    responses: {
      BadRequest: errorResponse(
        "Bad request.",
        "Request body validation failed.",
        "VALIDATION_ERROR",
        {
          field: ["Required field is missing."],
        },
      ),
      Unauthorized: errorResponse(
        "Unauthorized.",
        "Authorization header is required.",
        "UNAUTHORIZED",
      ),
      Forbidden: errorResponse(
        "Forbidden.",
        "You do not have permission to perform this action.",
        "FORBIDDEN",
      ),
      NotFound: errorResponse(
        "Not found.",
        "Requested resource was not found.",
        "NOT_FOUND",
      ),
      Conflict: errorResponse(
        "Conflict.",
        "The request conflicts with the current resource state.",
        "CONFLICT",
      ),
      UnprocessableEntity: errorResponse(
        "Unprocessable entity.",
        "Request body could not be processed.",
        "UNPROCESSABLE_ENTITY",
      ),
      TooManyRequests: errorResponse(
        "Too many requests.",
        "Rate limit exceeded.",
        "TOO_MANY_REQUESTS",
      ),
      InternalServerError: errorResponse(
        "Internal server error.",
        "Internal server error.",
        "INTERNAL_SERVER_ERROR",
      ),
      ServiceUnavailable: errorResponse(
        "Service unavailable.",
        "Health check failed.",
        "SERVICE_UNAVAILABLE",
      ),
    },
    parameters: {
      Page: queryParam(
        "page",
        { type: "integer", minimum: 1, default: 1 },
        "Page number.",
        1,
      ),
      PageSize: queryParam(
        "pageSize",
        { type: "integer", minimum: 1, maximum: 50, default: 20 },
        "Page size.",
        20,
      ),
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["code"],
        properties: {
          code: {
            type: "string",
          },
          details: {
            oneOf: [
              { type: "object", additionalProperties: true },
              {
                type: "array",
                items: { type: "object", additionalProperties: true },
              },
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
            ],
          },
        },
      },
      RequestMeta: {
        type: "object",
        required: ["requestId"],
        properties: {
          requestId: {
            type: "string",
          },
        },
        additionalProperties: true,
      },
      ExtendedRequestMeta: {
        allOf: [
          schemaRef("RequestMeta"),
          {
            type: "object",
            additionalProperties: true,
          },
        ],
      },
      ApiSuccessEnvelope: {
        type: "object",
        required: ["success", "message", "data", "error", "meta"],
        properties: {
          success: {
            type: "boolean",
            const: true,
          },
          message: {
            type: "string",
          },
          data: {},
          error: {
            type: "null",
          },
          meta: schemaRef("RequestMeta"),
        },
      },
      ApiErrorEnvelope: {
        type: "object",
        required: ["success", "message", "data", "error", "meta"],
        properties: {
          success: {
            type: "boolean",
            const: false,
          },
          message: {
            type: "string",
          },
          data: {
            type: "null",
          },
          error: schemaRef("ApiError"),
          meta: schemaRef("RequestMeta"),
        },
      },
      SystemRoot: {
        type: "object",
        properties: {
          apiVersion: { type: "string" },
          apiBasePath: { type: "string" },
        },
        required: ["apiVersion", "apiBasePath"],
      },
      HealthStatus: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          uptime: { type: "number" },
          checks: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["ok", "uptime", "checks"],
      },
      ActionOkResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          loggedOut: { type: "boolean" },
        },
        additionalProperties: true,
      },
      AcceptedActionResult: {
        type: "object",
        properties: {
          accepted: { type: "boolean" },
        },
        additionalProperties: true,
      },
      AuthResponseUser: {
        type: "object",
        required: [
          "id",
          "email",
          "username",
          "role",
          "organizationMembershipCount",
        ],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
          role: {
            type: "string",
            enum: ["user", "owner", "moderator", "admin"],
          },
          activeOrganization: schemaRef("OrganizationSummary"),
          organizationMembershipCount: { type: "integer", minimum: 0 },
        },
      },
      OrganizationRole: {
        type: "string",
        enum: ["primary_manager", "manager", "operator"],
      },
      OrganizationInviteStatus: {
        type: "string",
        enum: ["pending", "accepted", "revoked", "expired"],
      },
      OrganizationSummary: {
        type: "object",
        required: ["id", "name", "role"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: schemaRef("OrganizationRole"),
        },
      },
      OrganizationMembershipSummary: {
        allOf: [
          schemaRef("OrganizationSummary"),
          {
            type: "object",
            required: ["membershipId", "joinedAt", "isActive"],
            properties: {
              membershipId: { type: "string" },
              joinedAt: { type: "string", format: "date-time" },
              isActive: { type: "boolean" },
            },
          },
        ],
      },
      OrganizationWorkspaceResult: {
        type: "object",
        required: ["memberships"],
        properties: {
          memberships: {
            type: "array",
            items: schemaRef("OrganizationMembershipSummary"),
          },
          activeOrganization: schemaRef("OrganizationSummary"),
        },
      },
      SetActiveOrganizationRequest: {
        type: "object",
        required: ["organizationId"],
        properties: {
          organizationId: { type: "string" },
        },
      },
      SetActiveOrganizationResult: {
        type: "object",
        required: ["activeOrganization"],
        properties: {
          activeOrganization: schemaRef("OrganizationSummary"),
        },
      },
      UpdateOrganizationRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
      OrganizationDetailOrganization: {
        type: "object",
        required: ["id", "name", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      OrganizationMemberRecord: {
        type: "object",
        required: [
          "membershipId",
          "userId",
          "email",
          "username",
          "role",
          "joinedAt",
        ],
        properties: {
          membershipId: { type: "string" },
          userId: { type: "string" },
          email: { type: "string", format: "email" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
          role: schemaRef("OrganizationRole"),
          joinedAt: { type: "string", format: "date-time" },
        },
      },
      OrganizationInvitationActorSummary: {
        type: "object",
        required: ["id", "email", "username"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
        },
      },
      OrganizationInvitationRecord: {
        type: "object",
        required: [
          "id",
          "email",
          "emailHint",
          "role",
          "status",
          "expiresAt",
          "createdAt",
          "updatedAt",
          "invitedBy",
        ],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          emailHint: { type: "string" },
          role: schemaRef("OrganizationRole"),
          status: schemaRef("OrganizationInviteStatus"),
          expiresAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          acceptedAt: { type: "string", format: "date-time" },
          revokedAt: { type: "string", format: "date-time" },
          invitedBy: schemaRef("OrganizationInvitationActorSummary"),
          acceptedBy: schemaRef("OrganizationInvitationActorSummary"),
        },
      },
      OrganizationDetailResult: {
        type: "object",
        required: ["organization", "viewerRole", "members", "invitations"],
        properties: {
          organization: schemaRef("OrganizationDetailOrganization"),
          viewerRole: schemaRef("OrganizationRole"),
          members: {
            type: "array",
            items: schemaRef("OrganizationMemberRecord"),
          },
          invitations: {
            type: "array",
            items: schemaRef("OrganizationInvitationRecord"),
          },
        },
      },
      CreateOrganizationInvitationRequest: {
        type: "object",
        required: ["email", "role"],
        properties: {
          email: { type: "string", format: "email" },
          role: {
            type: "string",
            enum: ["manager", "operator"],
          },
        },
      },
      CreateOrganizationInviteResult: {
        type: "object",
        required: ["invitation"],
        properties: {
          invitation: schemaRef("OrganizationInvitationRecord"),
        },
      },
      UpdateOrganizationMemberRequest: {
        type: "object",
        required: ["role"],
        properties: {
          role: {
            type: "string",
            enum: ["manager", "operator", "primary_manager"],
          },
        },
      },
      UpdateOrganizationMemberResult: {
        type: "object",
        required: ["member"],
        properties: {
          member: schemaRef("OrganizationMemberRecord"),
        },
      },
      RemoveOrganizationMemberResult: {
        type: "object",
        required: ["removed", "membershipId"],
        properties: {
          removed: { type: "boolean" },
          membershipId: { type: "string" },
        },
      },
      OrganizationInvitePreviewResult: {
        type: "object",
        required: ["invitation", "viewer"],
        properties: {
          invitation: {
            type: "object",
            required: [
              "organizationId",
              "organizationName",
              "emailHint",
              "role",
              "status",
              "expiresAt",
            ],
            properties: {
              organizationId: { type: "string" },
              organizationName: { type: "string" },
              emailHint: { type: "string" },
              role: schemaRef("OrganizationRole"),
              status: schemaRef("OrganizationInviteStatus"),
              expiresAt: { type: "string", format: "date-time" },
            },
          },
          viewer: {
            type: "object",
            required: ["authenticated", "matchesEmail", "canAccept"],
            properties: {
              authenticated: { type: "boolean" },
              email: { type: "string", format: "email" },
              emailVerified: { type: "boolean" },
              matchesEmail: { type: "boolean" },
              canAccept: { type: "boolean" },
            },
          },
        },
      },
      AcceptOrganizationInviteResult: {
        type: "object",
        required: ["accepted", "organization", "membership"],
        properties: {
          accepted: { type: "boolean" },
          organization: schemaRef("OrganizationSummary"),
          membership: schemaRef("OrganizationMembershipSummary"),
        },
      },
      AuthSessionResponseData: {
        type: "object",
        required: ["accessToken", "device", "user"],
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          device: {
            type: "object",
            required: ["known", "knownByIp"],
            properties: {
              deviceId: { type: "string" },
              known: { type: "boolean" },
              knownByIp: { type: "boolean" },
            },
          },
          user: schemaRef("AuthResponseUser"),
        },
      },
      SignupVerificationPendingResult: {
        type: "object",
        required: ["verificationRequired", "email", "alreadyPending"],
        properties: {
          verificationRequired: { type: "boolean" },
          email: { type: "string", format: "email" },
          alreadyPending: { type: "boolean" },
        },
      },
      SessionVerificationResult: {
        type: "object",
        additionalProperties: true,
      },
      LinkedOAuthProvidersResult: {
        type: "object",
        required: ["hasPassword", "providers"],
        properties: {
          hasPassword: { type: "boolean" },
          providers: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "provider", "emailVerified", "linkedAt"],
              properties: {
                id: { type: "string" },
                provider: {
                  type: "string",
                  enum: ["google", "microsoft", "apple"],
                },
                providerEmail: { type: "string", format: "email" },
                emailVerified: { type: "boolean" },
                displayName: { type: "string" },
                linkedAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      KnownDevicesResult: {
        type: "object",
        properties: {
          devices: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        required: ["devices"],
      },
      LocalAuthenticateRequest: {
        type: "object",
        required: ["email", "password", "captchaToken"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
          captchaToken: { type: "string" },
          rememberMe: { type: "boolean" },
          deviceId: { type: "string" },
        },
      },
      LocalSignupRequest: {
        type: "object",
        required: ["email", "password", "captchaToken"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
          captchaToken: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          deviceId: { type: "string" },
        },
      },
      ForgotPasswordRequest: {
        type: "object",
        required: ["email", "captchaToken"],
        properties: {
          email: { type: "string", format: "email" },
          captchaToken: { type: "string" },
        },
      },
      ResendVerificationEmailRequest: {
        type: "object",
        required: ["email", "captchaToken"],
        properties: {
          email: { type: "string", format: "email" },
          captchaToken: { type: "string" },
        },
      },
      UnlockLocalLoginRequest: {
        type: "object",
        required: ["email", "code"],
        properties: {
          email: { type: "string", format: "email" },
          code: { type: "string", pattern: "^\\d{6}$" },
        },
      },
      ResendUnlockLocalLoginRequest: {
        type: "object",
        required: ["email", "captchaToken"],
        properties: {
          email: { type: "string", format: "email" },
          captchaToken: { type: "string" },
        },
      },
      VerifyEmailRequest: {
        type: "object",
        required: ["email", "code"],
        properties: {
          email: { type: "string", format: "email" },
          code: { type: "string", pattern: "^\\d{6}$" },
          deviceId: { type: "string" },
        },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["email", "code", "newPassword"],
        properties: {
          email: { type: "string", format: "email" },
          code: { type: "string", pattern: "^\\d{6}$" },
          newPassword: { type: "string" },
          deviceId: { type: "string" },
        },
      },
      ChangePasswordRequest: {
        type: "object",
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string" },
          newPassword: { type: "string" },
        },
      },
      OAuthAuthenticateRequest: {
        type: "object",
        required: ["nonce"],
        properties: {
          code: { type: "string" },
          codeVerifier: { type: "string" },
          idToken: { type: "string" },
          nonce: { type: "string" },
          rememberMe: { type: "boolean" },
          deviceId: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
        },
      },
      RefreshRequest: {
        type: "object",
        properties: {
          refreshToken: { type: "string" },
        },
      },
      RemoveKnownDeviceRequest: {
        type: "object",
        required: ["deviceId"],
        properties: {
          deviceId: { type: "string" },
        },
      },
      PersonalAccessTokenListResult: {
        type: "object",
        properties: {
          tokens: {
            type: "array",
            items: schemaRef("PersonalAccessTokenSummary"),
          },
        },
        required: ["tokens"],
      },
      PersonalAccessTokenSummary: {
        type: "object",
        required: [
          "id",
          "name",
          "tokenPrefix",
          "scopes",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          tokenPrefix: { type: "string" },
          scopes: {
            type: "array",
            items: {
              type: "string",
              enum: ["mcp:read", "mcp:write"],
            },
          },
          lastUsedAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
          revokedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CreatePersonalAccessTokenRequest: {
        type: "object",
        required: ["name", "scopes"],
        properties: {
          name: { type: "string" },
          scopes: {
            type: "array",
            items: {
              type: "string",
              enum: ["mcp:read", "mcp:write"],
            },
          },
          expiresAt: { type: "string", format: "date-time" },
          expiresInDays: { type: "integer", minimum: 1, maximum: 365 },
        },
      },
      CreatePersonalAccessTokenResult: {
        allOf: [
          schemaRef("PersonalAccessTokenSummary"),
          {
            type: "object",
            required: ["token"],
            properties: {
              token: { type: "string" },
            },
          },
        ],
      },
      RevokePersonalAccessTokenResult: {
        type: "object",
        required: ["revoked", "tokenId"],
        properties: {
          revoked: { type: "boolean" },
          tokenId: { type: "string" },
        },
      },
      CreateBlobUploadUrlRequest: {
        type: "object",
        required: ["filename", "contentType"],
        properties: {
          filename: { type: "string" },
          contentType: { type: "string" },
          scope: { type: "string" },
        },
      },
      BlobUploadTarget: {
        type: "object",
        required: [
          "method",
          "uploadUrl",
          "expiresAt",
          "blobName",
          "blobUrl",
          "container",
          "headers",
        ],
        properties: {
          method: { type: "string", const: "PUT" },
          uploadUrl: { type: "string", format: "uri" },
          expiresAt: { type: "string", format: "date-time" },
          blobName: { type: "string" },
          blobUrl: { type: "string", format: "uri" },
          container: { type: "string" },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
      },
      PublicProfileRecord: {
        type: "object",
        additionalProperties: true,
      },
      ProfileRecord: {
        type: "object",
        additionalProperties: true,
      },
      ListProfilesResult: {
        type: "object",
        properties: {
          profiles: {
            type: "array",
            items: schemaRef("PublicProfileRecord"),
          },
          pagination: schemaRef("Pagination"),
          query: { type: "string" },
        },
        required: ["profiles", "pagination"],
      },
      UpdateProfileRequest: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string" },
          phoneNumber: { type: "string" },
          isPrivate: { type: "boolean" },
          recommendationPersonalizationEnabled: { type: "boolean" },
          avatarUrl: { type: "string", format: "uri" },
          avatarBlobName: { type: "string" },
          trustworthinessScore: { type: "integer", minimum: 1, maximum: 5 },
          rentPostingsCount: { type: "integer", minimum: 0 },
          availableRentPostingsCount: { type: "integer", minimum: 0 },
        },
      },
      FeedbackCategory: {
        type: "string",
        enum: [
          "bug_report",
          "feature_request",
          "usability",
          "praise",
          "other",
        ],
      },
      CreateAppFeedbackRequest: {
        type: "object",
        required: ["name", "email", "category", "message"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 160 },
          email: { type: "string", format: "email" },
          category: schemaRef("FeedbackCategory"),
          message: { type: "string", minLength: 10, maxLength: 2000 },
          captchaToken: {
            type: "string",
            description:
              "Required when the request is anonymous. Signed-in callers may omit this field.",
          },
        },
      },
      AppFeedbackSubmissionReceipt: {
        type: "object",
        required: ["id", "category", "createdAt"],
        properties: {
          id: { type: "string" },
          category: schemaRef("FeedbackCategory"),
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Pagination: {
        type: "object",
        required: [
          "page",
          "pageSize",
          "total",
          "totalPages",
          "hasNextPage",
          "hasPreviousPage",
        ],
        properties: {
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
          hasNextPage: { type: "boolean" },
          hasPreviousPage: { type: "boolean" },
        },
      },
      PostingRecord: {
        type: "object",
        additionalProperties: true,
      },
      PublicPostingRecord: {
        type: "object",
        additionalProperties: true,
      },
      ListOwnerPostingsResult: {
        type: "object",
        properties: {
          postings: {
            type: "array",
            items: schemaRef("PostingRecord"),
          },
          pagination: schemaRef("Pagination"),
          status: { type: "string" },
        },
        required: ["postings", "pagination"],
      },
      BatchOwnerPostingsResult: {
        type: "object",
        properties: {
          postings: {
            type: "array",
            items: schemaRef("PostingRecord"),
          },
          missingIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["postings", "missingIds"],
      },
      BatchPublicPostingsResult: {
        type: "object",
        properties: {
          postings: {
            type: "array",
            items: schemaRef("PublicPostingRecord"),
          },
          missingIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["postings", "missingIds"],
      },
      SearchPostingsResult: {
        type: "object",
        properties: {
          postings: {
            type: "array",
            items: schemaRef("PublicPostingRecord"),
          },
          pagination: schemaRef("Pagination"),
          source: {
            type: "string",
            enum: ["elasticsearch", "database"],
          },
          query: { type: "string" },
        },
        required: ["postings", "pagination", "source"],
      },
      PostingAutocompleteResult: {
        type: "object",
        properties: {
          query: { type: "string" },
          suggestions: {
            type: "array",
            items: {
              type: "object",
              required: ["value", "kind"],
              properties: {
                value: { type: "string" },
                kind: {
                  type: "string",
                  enum: ["name", "tag", "location"],
                },
              },
            },
          },
          source: {
            type: "string",
            enum: ["elasticsearch", "database"],
          },
        },
        required: ["query", "suggestions", "source"],
      },
      RecommendationQueryResult: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["posting", "reasonCodes"],
              properties: {
                posting: schemaRef("PublicPostingRecord"),
                reasonCodes: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
          pagination: schemaRef("Pagination"),
          mode: {
            type: "string",
            enum: ["personalized", "popular"],
          },
          fallback: { type: "boolean" },
          fallbackReason: {
            type: "string",
            enum: ["missing_snapshot", "stale_snapshot", "unqualified_profile"],
          },
          snapshotGeneratedAt: { type: "string", format: "date-time" },
        },
        required: ["items", "pagination", "mode", "fallback"],
      },
      UpsertPostingRequest: {
        type: "object",
        additionalProperties: true,
      },
      UpdatePostingRequest: {
        type: "object",
        additionalProperties: true,
      },
      PostingAvailabilityBlockRecord: {
        type: "object",
        additionalProperties: true,
      },
      AvailabilityBlockListResult: {
        type: "object",
        required: ["availabilityBlocks"],
        properties: {
          availabilityBlocks: {
            type: "array",
            items: schemaRef("PostingAvailabilityBlockRecord"),
          },
        },
      },
      OwnerAvailabilityBlockRequest: {
        type: "object",
        required: ["startAt", "endAt"],
        properties: {
          startAt: { type: "string", format: "date-time" },
          endAt: { type: "string", format: "date-time" },
          note: { type: "string" },
        },
      },
      CreatePostingReviewRequest: {
        type: "object",
        required: ["rating"],
        properties: {
          rating: { type: "integer", minimum: 1, maximum: 5 },
          title: { type: "string" },
          comment: { type: "string" },
        },
      },
      PostingReviewRecord: {
        type: "object",
        additionalProperties: true,
      },
      ListPostingReviewsResult: {
        type: "object",
        properties: {
          reviews: {
            type: "array",
            items: schemaRef("PostingReviewRecord"),
          },
          summary: {
            type: "object",
            properties: {
              averageRating: { type: "number" },
              reviewCount: { type: "integer" },
            },
            required: ["averageRating", "reviewCount"],
          },
          pagination: schemaRef("Pagination"),
        },
        required: ["reviews", "summary", "pagination"],
      },
      CreateReportRequest: {
        type: "object",
        required: [
          "subjectType",
          "subjectId",
          "reasonCode",
          "title",
          "description",
        ],
        properties: {
          subjectType: {
            type: "string",
            enum: ["posting", "posting_review", "user"],
          },
          subjectId: { type: "string" },
          reasonCode: {
            type: "string",
            enum: [
              "spam",
              "fraud_or_scam",
              "harassment_or_hate",
              "sexual_content",
              "violence_or_threats",
              "illegal_or_prohibited",
              "impersonation",
              "misleading_information",
              "review_manipulation",
              "other",
            ],
          },
          title: { type: "string", minLength: 3, maxLength: 120 },
          description: { type: "string", minLength: 10, maxLength: 2000 },
        },
      },
      ContentReportUserSummary: {
        type: "object",
        required: ["id", "email", "role"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
          role: {
            type: "string",
            enum: ["user", "owner", "moderator", "admin"],
          },
        },
      },
      ContentReportSubjectSnapshot: {
        type: "object",
        required: ["subjectType", "summaryText"],
        properties: {
          subjectType: {
            type: "string",
            enum: ["posting", "posting_review", "user"],
          },
          summaryText: { type: "string" },
          posting: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              status: { type: "string" },
              organization: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
          review: {
            type: "object",
            properties: {
              id: { type: "string" },
              rating: { type: "integer" },
              title: { type: "string" },
              commentExcerpt: { type: "string" },
              reviewer: schemaRef("ContentReportUserSummary"),
              posting: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
          user: schemaRef("ContentReportUserSummary"),
        },
      },
      ContentReportEventRecord: {
        type: "object",
        required: ["id", "eventType", "actor", "createdAt"],
        properties: {
          id: { type: "string" },
          eventType: {
            type: "string",
            enum: ["created", "assigned", "status_changed", "note_added"],
          },
          fromStatus: {
            type: "string",
            enum: ["open", "under_review", "resolved", "dismissed"],
          },
          toStatus: {
            type: "string",
            enum: ["open", "under_review", "resolved", "dismissed"],
          },
          assignmentUserId: { type: "string" },
          note: { type: "string" },
          actor: schemaRef("ContentReportUserSummary"),
          createdAt: { type: "string", format: "date-time" },
        },
      },
      ContentReportRecord: {
        type: "object",
        required: [
          "id",
          "reporterId",
          "subjectType",
          "subjectId",
          "reasonCode",
          "title",
          "description",
          "status",
          "createdAt",
          "updatedAt",
          "reporter",
          "subjectSnapshot",
        ],
        properties: {
          id: { type: "string" },
          reporterId: { type: "string" },
          subjectType: {
            type: "string",
            enum: ["posting", "posting_review", "user"],
          },
          subjectId: { type: "string" },
          reasonCode: {
            type: "string",
            enum: [
              "spam",
              "fraud_or_scam",
              "harassment_or_hate",
              "sexual_content",
              "violence_or_threats",
              "illegal_or_prohibited",
              "impersonation",
              "misleading_information",
              "review_manipulation",
              "other",
            ],
          },
          title: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["open", "under_review", "resolved", "dismissed"],
          },
          resolutionCode: {
            type: "string",
            enum: [
              "action_taken",
              "no_violation",
              "duplicate",
              "insufficient_information",
            ],
          },
          resolutionSummary: { type: "string" },
          reviewedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          reporter: schemaRef("ContentReportUserSummary"),
          assignedModerator: schemaRef("ContentReportUserSummary"),
          subjectSnapshot: schemaRef("ContentReportSubjectSnapshot"),
        },
      },
      ContentReportDetailRecord: {
        allOf: [
          schemaRef("ContentReportRecord"),
          {
            type: "object",
            required: ["events"],
            properties: {
              events: {
                type: "array",
                items: schemaRef("ContentReportEventRecord"),
              },
            },
          },
        ],
      },
      ListContentReportsResult: {
        type: "object",
        required: ["reports", "pagination", "source"],
        properties: {
          reports: {
            type: "array",
            items: schemaRef("ContentReportRecord"),
          },
          pagination: schemaRef("Pagination"),
          source: {
            type: "string",
            enum: ["elasticsearch", "database"],
          },
          query: { type: "string" },
        },
      },
      AssignContentReportRequest: {
        type: "object",
        properties: {
          assignedModeratorId: {
            oneOf: [{ type: "string" }, { type: "null" }],
          },
        },
      },
      UpdateContentReportStatusRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["open", "under_review", "resolved", "dismissed"],
          },
          resolutionCode: {
            type: "string",
            enum: [
              "action_taken",
              "no_violation",
              "duplicate",
              "insufficient_information",
            ],
          },
          resolutionSummary: { type: "string" },
          note: { type: "string" },
        },
      },
      SearchClickActivityRequest: {
        type: "object",
        required: [
          "searchSessionId",
          "page",
          "position",
          "hasGeoFilter",
          "hasAvailabilityFilter",
        ],
        properties: {
          searchSessionId: { type: "string" },
          query: { type: "string" },
          family: { type: "string" },
          subtype: { type: "string" },
          page: { type: "integer", minimum: 1 },
          position: { type: "integer", minimum: 0 },
          hasGeoFilter: { type: "boolean" },
          hasAvailabilityFilter: { type: "boolean" },
        },
      },
      OwnerPostingsAnalyticsSummary: {
        type: "object",
        additionalProperties: true,
      },
      PostingAnalyticsListResult: {
        type: "object",
        additionalProperties: true,
      },
      PostingAnalyticsDetail: {
        type: "object",
        additionalProperties: true,
      },
      CreateBookingRequest: {
        type: "object",
        required: ["startAt", "endAt", "contactName", "contactEmail"],
        properties: {
          startAt: { type: "string", format: "date-time" },
          endAt: { type: "string", format: "date-time" },
          guestCount: { type: "integer", minimum: 1, maximum: 20 },
          note: { type: "string" },
          contactName: { type: "string" },
          contactEmail: { type: "string", format: "email" },
          contactPhoneNumber: { type: "string" },
        },
      },
      BookingQuoteRequest: {
        type: "object",
        required: ["startAt", "endAt"],
        properties: {
          startAt: { type: "string", format: "date-time" },
          endAt: { type: "string", format: "date-time" },
          guestCount: { type: "integer", minimum: 1, maximum: 20 },
          note: { type: "string" },
        },
      },
      BookingDecisionRequest: {
        type: "object",
        properties: {
          note: { type: "string" },
        },
      },
      CancelBookingRequest: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
      },
      BookingRequestRecord: {
        type: "object",
        additionalProperties: true,
      },
      BookingRequestsListResult: {
        type: "object",
        properties: {
          bookingRequests: {
            type: "array",
            items: schemaRef("BookingRequestRecord"),
          },
          pagination: schemaRef("Pagination"),
          status: { type: "string" },
        },
        required: ["bookingRequests", "pagination"],
      },
      BookingQuoteResult: {
        type: "object",
        additionalProperties: true,
      },
      BookingCancellationQuoteResult: {
        type: "object",
        additionalProperties: true,
      },
      RenterBookingDashboardResult: {
        type: "object",
        additionalProperties: true,
      },
      OwnerBookingDashboardResult: {
        type: "object",
        additionalProperties: true,
      },
      IdempotentMutationRequest: {
        type: "object",
        properties: {
          idempotencyKey: { type: "string" },
        },
      },
      CreateRefundRequest: {
        type: "object",
        required: ["amount"],
        properties: {
          amount: { type: "number", exclusiveMinimum: 0 },
          reason: { type: "string" },
          idempotencyKey: { type: "string" },
        },
      },
      PaymentRecord: {
        type: "object",
        additionalProperties: true,
      },
      PayoutListResult: {
        type: "object",
        properties: {
          payouts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
          pagination: schemaRef("Pagination"),
          status: { type: "string" },
        },
        required: ["payouts", "pagination"],
      },
      RentingRecord: {
        type: "object",
        additionalProperties: true,
      },
      ListRentingsResult: {
        type: "object",
        properties: {
          rentings: {
            type: "array",
            items: schemaRef("RentingRecord"),
          },
          pagination: schemaRef("Pagination"),
          status: { type: "string" },
        },
        required: ["rentings", "pagination"],
      },
      UpdateRentingInstructionsRequest: {
        type: "object",
        required: ["pickupInstructions", "returnInstructions"],
        properties: {
          pickupInstructions: { type: "string" },
          returnInstructions: { type: "string" },
        },
      },
      CreateRentingDisputeRequest: {
        type: "object",
        required: ["reason"],
        properties: {
          reason: { type: "string" },
          details: { type: "string" },
        },
      },
      SearchReindexRunRecord: {
        type: "object",
        additionalProperties: true,
      },
      SearchReindexRunLookupResult: {
        type: "object",
        properties: {
          run: {
            oneOf: [schemaRef("SearchReindexRunRecord"), { type: "null" }],
          },
        },
        required: ["run"],
      },
      SearchStatusResult: {
        type: "object",
        additionalProperties: true,
      },
      ReplayDeadLetteredSearchOutboxResult: {
        type: "object",
        properties: {
          revived: { type: "integer" },
        },
        required: ["revived"],
      },
      CleanupRetainedSearchIndicesResult: {
        type: "object",
        properties: {
          deleted: { type: "integer" },
        },
        required: ["deleted"],
      },
    },
  };
}

export function buildOpenApiDocument(): Record<string, unknown> {
  return stripUndefinedDeep({
    openapi: "3.1.0",
    info: {
      title: "Rentify Backend API",
      version: "1.0.0",
      description: [
        "Canonical OpenAPI document for the Rentify backend.",
        "",
        "Base path: `/api/v1`.",
        "",
        "Response format:",
        "- JSON is the default response format.",
        "- XML is supported on body-bearing responses with `?format=xml` or `Accept: application/xml`.",
        "",
        "Authentication notes:",
        "- Most protected routes use a bearer token in the `Authorization` header.",
        "- Browser refresh/logout flows can use the `refresh_token` cookie and must send `x-csrf-token` when a CSRF cookie is present.",
        "- Personal access token support is limited to the allowlisted routes documented in `x-rentify-permissions`.",
        "- `POST /payments/webhooks/square` uses the `x-square-hmacsha256-signature` header instead of bearer authentication.",
      ].join("\n"),
    },
    servers: [
      {
        url: "http://localhost:8040/api/v1",
        description: "Local Docker backend",
      },
    ],
    tags: [
      {
        name: "system",
        description: "Health, discovery, and OpenAPI endpoints.",
      },
      {
        name: "auth",
        description: "Local auth, OAuth auth, and session/device flows.",
      },
      {
        name: "personal-access-tokens",
        description: "PAT creation and lifecycle management.",
      },
      {
        name: "organizations",
        description:
          "Organization memberships, invitations, active-org switching, and member management.",
      },
      {
        name: "profiles",
        description:
          "Public profile browsing and current-user profile management.",
      },
      {
        name: "feedback",
        description:
          "Public app feedback submission with optional authenticated context.",
      },
      { name: "blob", description: "Blob upload target creation." },
      {
        name: "postings",
        description:
          "Posting creation, search, analytics, reviews, and availability management.",
      },
      {
        name: "booking-requests",
        description: "Booking request creation, review, and dashboards.",
      },
      {
        name: "payments",
        description:
          "Payment sessions, refunds, payouts, and provider webhooks.",
      },
      {
        name: "rentings",
        description:
          "Booking-to-renting conversion and renting lifecycle management.",
      },
      {
        name: "admin-search",
        description: "Administrative search maintenance and telemetry routes.",
      },
      {
        name: "moderation",
        description: "Safety reporting and moderator review workflows.",
      },
    ],
    paths: buildDocumentPaths(),
    components: buildComponents(),
  });
}

export function buildOpenApiYaml(): string {
  return `${yaml.dump(buildOpenApiDocument(), {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  })}`.replace(/\r\n/g, "\n");
}

export function buildOpenApiJson(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`.replace(
    /\r\n/g,
    "\n",
  );
}
