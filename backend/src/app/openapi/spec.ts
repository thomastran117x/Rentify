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
  slug: "northwind",
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
const organizationWorkspaceDetailExample = {
  organization: {
    id: "org-1",
    slug: "northwind",
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
const publicOrganizationExample = {
  id: "org-1",
  slug: "northwind",
  name: "Northwind",
  description: "Boutique rental studio for coastal getaways.",
  websiteUrl: "https://northwind.example.com",
  addressLine1: "500 Harbor Way",
  addressLine2: null,
  city: "Santa Cruz",
  region: "CA",
  country: "US",
  postalCode: "95060",
  logoUrl: "https://cdn.rentify.local/logos/org-1.png",
  customFields: { "Response time": "Within 24 hours" },
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  publishedPostingCount: 2,
};
const publicOrganizationListExample = {
  organizations: [publicOrganizationExample],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  query: "north",
};
const publicOrganizationDetailExample = {
  organization: publicOrganizationExample,
  stats: {
    publishedPostingCount: 2,
  },
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
    slug: "northwind",
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
const organizationAuditExample = {
  id: "audit-1",
  organizationId: "org-1",
  actor: {
    id: "user-1",
    email: "owner1@rentify.local",
    username: "owner-one",
    avatarUrl: "https://cdn.rentify.local/avatars/owner-1.png",
  },
  action: "organization.renamed",
  resourceType: "organization",
  resourceId: "org-1",
  organizationVersion: 2,
  resourceVersion: 2,
  summary: "Organization renamed from Northwind to Northwind Creative.",
  changes: [
    {
      field: "name",
      before: "Northwind",
      after: "Northwind Creative",
    },
  ],
  beforeSnapshot: {
    id: "org-1",
    name: "Northwind",
  },
  afterSnapshot: {
    id: "org-1",
    name: "Northwind Creative",
  },
  restorable: true,
  createdAt: "2026-05-28T11:15:00.000Z",
};
const organizationAuditListExample = {
  auditLogs: [organizationAuditExample],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};
const organizationAnnouncementExample = {
  id: "announcement-1",
  organizationId: "org-1",
  author: {
    id: "user-1",
    email: "owner1@rentify.local",
    username: "owner-one",
    avatarUrl: "https://cdn.rentify.local/avatars/owner-1.png",
  },
  title: "Summer availability update",
  body: "Our downtown studios now accept weekend bookings.",
  status: "published",
  publishedAt: "2026-05-28T11:15:00.000Z",
  createdAt: "2026-05-28T11:15:00.000Z",
  updatedAt: "2026-05-28T11:15:00.000Z",
};
const organizationAnnouncementListExample = {
  announcements: [organizationAnnouncementExample],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};
const organizationBlogPostExample = {
  id: "blog-1",
  organizationId: "org-1",
  author: {
    id: "user-1",
    email: "owner1@rentify.local",
    username: "owner-one",
    avatarUrl: "https://cdn.rentify.local/avatars/owner-1.png",
  },
  title: "Introducing weekend stays at our downtown studios",
  slug: "introducing-weekend-stays",
  excerpt: "Weekend bookings are now open across every downtown studio.",
  body: "<h2>Weekend stays are here</h2><p>Book any downtown studio for the weekend.</p>",
  coverImageUrl:
    "https://cdn.rentify.local/organizations/org-1/blog/cover-1.png",
  coverImageBlobName: "organizations/org-1/blog/cover-1.png",
  tags: ["announcement", "downtown"],
  status: "published",
  commentsEnabled: true,
  publishedAt: "2026-05-28T11:15:00.000Z",
  createdAt: "2026-05-28T11:15:00.000Z",
  updatedAt: "2026-05-28T11:15:00.000Z",
};
const organizationBlogCommentExample = {
  id: "blog-comment-1",
  blogPostId: "blog-1",
  organizationId: "org-1",
  author: {
    id: "user-2",
    username: "renter-one",
    avatarUrl: "https://cdn.rentify.local/avatars/renter-1.png",
  },
  body: "This is exactly what we needed for the weekend.",
  createdAt: "2026-05-29T09:00:00.000Z",
  editedAt: null,
  deletedAt: null,
  deletedBy: null,
};
const organizationBlogCommentTombstoneExample = {
  id: "blog-comment-2",
  blogPostId: "blog-1",
  organizationId: "org-1",
  author: {
    id: "user-3",
    username: "renter-two",
  },
  body: "",
  createdAt: "2026-05-29T09:05:00.000Z",
  editedAt: null,
  deletedAt: "2026-05-29T10:00:00.000Z",
  deletedBy: "moderator",
};
const organizationBlogCommentListExample = {
  comments: [organizationBlogCommentExample],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  commentsEnabled: true,
  viewerCanComment: true,
  viewerCanModerate: false,
  viewerUserId: "user-2",
};
const organizationBlogPostListExample = {
  posts: [organizationBlogPostExample],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};
const organizationReviewExample = {
  id: "review-1",
  organizationId: "org-1",
  reviewerId: "user-2",
  rating: 5,
  title: "Smooth end-to-end rental",
  comment: "Pickup was effortless and the team was responsive throughout.",
  reviewer: {
    username: "renter-two",
    avatarUrl: "https://cdn.rentify.local/avatars/renter-2.png",
  },
  response: {
    body: "Thank you for renting with us — see you next time!",
    respondedAt: "2026-06-02T09:00:00.000Z",
    author: {
      id: "user-1",
      username: "owner-one",
      avatarUrl: "https://cdn.rentify.local/avatars/owner-1.png",
    },
  },
  createdAt: "2026-06-01T18:30:00.000Z",
  updatedAt: "2026-06-01T18:30:00.000Z",
};
const organizationReviewListExample = {
  reviews: [organizationReviewExample],
  summary: {
    averageRating: 5,
    reviewCount: 1,
  },
  pagination: {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};
const organizationAuditRestoreExample = {
  restored: true,
  auditLog: {
    ...organizationAuditExample,
    id: "audit-2",
    action: "organization.restored",
    organizationVersion: 3,
    resourceVersion: 3,
    summary: "Organization name was restored to Northwind.",
    restorable: false,
    restoredFromAuditId: "audit-1",
    createdAt: "2026-05-28T11:20:00.000Z",
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
  usernameChangedAt: "2026-08-01T12:00:00.000Z",
  usernameAutoGenerated: false,
  canChangeUsername: false,
  usernameChangeAvailableAt: "2026-08-31T12:00:00.000Z",
  isPrivate: false,
  recommendationPersonalizationEnabled: true,
};
const postingExample = {
  id: "posting-1",
  organizationId: "org-1",
  organization: {
    id: "org-1",
    name: "Owner One Organization",
    slug: "owner-one-organization",
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
  organizationFilter: {
    query: "Owner One Organization",
    matches: [
      {
        id: "org-1",
        name: "Owner One Organization",
        slug: "owner-one-organization",
      },
    ],
    truncated: false,
  },
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
const savedPostingStateExample = {
  postingId: "posting-1",
  saved: true,
  savedAt: "2026-08-01T12:00:00.000Z",
};
const savedPostingsResultExample = {
  postings: [
    {
      ...postingExample,
      savedAt: "2026-08-01T12:00:00.000Z",
    },
  ],
  pagination: searchResultExample.pagination,
  unavailablePostings: [
    {
      postingId: "posting-9",
      name: "Harbourside Studio",
      reason: "paused",
      savedAt: "2026-07-20T09:30:00.000Z",
    },
  ],
};
const savedPostingIdsResultExample = {
  postingIds: ["posting-1", "posting-2"],
  truncated: false,
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
const bookingMessageExample = {
  id: "booking-message-1",
  bookingRequestId: "booking-1",
  authorId: "user-1",
  authorSide: "renter",
  authorUsername: "renter-one",
  body: "Is an early pickup possible on the first day?",
  createdAt: "2026-05-26T08:00:00.000Z",
  readAt: null,
  deliveredAt: null,
  editedAt: null,
  deletedAt: null,
};

const bookingRequestExample = {
  id: "booking-1",
  postingId: "posting-1",
  renterId: "user-1",
  organizationId: "org-1",
  status: "awaiting_payment",
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
// A freshly created request on a non-instant posting stays pending until the
// owner approves it. Instant-book postings instead return the awaiting_payment
// example above with an additional `autoApproved: true` flag.
const bookingRequestPendingExample = {
  ...bookingRequestExample,
  status: "pending",
  decisionNote: undefined,
  approvedAt: undefined,
  paymentRequiredAt: undefined,
  holdExpiresAt: "2026-05-26T11:00:00.000Z",
  updatedAt: "2026-05-25T11:00:00.000Z",
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
          "TypeScript Express server is running",
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
      summary: "Authenticate with username and password",
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
        username: "owner-one",
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
        username: "taylor-renter",
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
        "Starts the password reset flow for a local account. The accepted response does not confirm whether the username exists.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("ForgotPasswordRequest", {
        username: "owner-one",
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
        username: "owner-one",
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
      path: "/auth/local/username/forgot",
      operationId: "forgotUsername",
      summary: "Recover a forgotten username",
      description:
        "Emails the account username to the address on file. Useful for OAuth-created accounts whose username was auto-generated, and for any local account that forgot its username. The accepted response does not confirm whether an account exists for the email.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("ForgotUsernameRequest", {
        email: "owner1@rentify.local",
        captchaToken: "turnstile-token",
      }),
      responses: {
        "202": successResponse(
          202,
          "Username reminder instructions have been accepted.",
          "AcceptedActionResult",
          actionAcceptedExample,
        ),
        ...commonErrors([400, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/auth/username/available",
      operationId: "checkUsernameAvailability",
      summary: "Check whether a username can be claimed",
      description:
        "Reports whether a username is free, so signup and account settings can tell the user before they submit. A username is unavailable when another account holds it or an unverified signup has reserved it. Signed-in callers are exempted from their own current username, which is therefore reported as available.",
      tags: ["auth"],
      permissions: {
        authMode: "public-or-session-bearer",
        minimumRole: null,
        patAllowed: false,
        rateLimitPolicy: "username-availability",
      },
      parameters: [
        queryParam(
          "username",
          {
            type: "string",
            minLength: 3,
            maxLength: 50,
            pattern: "^[A-Za-z0-9._-]+$",
          },
          "The username to check. Trimmed and lowercased before lookup.",
          "taylor-renter",
          true,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "UsernameAvailabilityResult",
          {
            username: "taylor-renter",
            available: false,
            reason: "taken",
          },
        ),
        ...commonErrors([400, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/local/password/reset",
      operationId: "resetPassword",
      summary: "Complete a password reset",
      description:
        "Completes a local password reset with the code sent to the email on file and returns an authenticated session.",
      tags: ["auth"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
        csrf: "Required for browser-origin requests to /auth/*.",
      },
      requestBody: requestBody("ResetPasswordRequest", {
        username: "owner-one",
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
      path: "/auth/mfa/verify/options",
      operationId: "getMfaVerificationOptions",
      summary: "Get MFA step-up verification options",
      description:
        "Returns whether the current session already holds a valid step-up proof for the requested scope, along with the factors available to the signed-in user. Requires a signed-in session; PAT authentication is rejected.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "scope",
          { type: "string", enum: ["mfa-management", "device-login"] },
          "Step-up verification scope.",
          "mfa-management",
          true,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "MfaVerificationOptionsResult",
          {
            scope: "mfa-management",
            verified: false,
            verifiedUntil: null,
            availableFactors: ["email", "totp"],
            recommendedFactor: "totp",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/mfa/verify/challenge",
      operationId: "issueMfaVerificationChallenge",
      summary: "Issue an MFA step-up challenge",
      description:
        "Starts a step-up challenge for the requested scope and factor. Email factors send a one-time code; TOTP factors signal the client to prompt for an authenticator code. Rate limited per user, session, scope, and factor.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("MfaVerificationChallengeRequest", {
        scope: "mfa-management",
        factor: "email",
      }),
      responses: {
        "200": successResponse(
          200,
          "Verification challenge issued.",
          "MfaVerificationChallengeResult",
          {
            scope: "mfa-management",
            factor: "email",
            challengeId: null,
            cooldownUntil: "2026-07-20T18:15:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/mfa/verify/confirm",
      operationId: "confirmMfaVerificationChallenge",
      summary: "Confirm an MFA step-up challenge",
      description:
        "Verifies a step-up challenge code and persists a short-lived MFA proof for the scope. Rate limited, with a temporary lockout after repeated failed attempts.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        rateLimitPolicy: "auth-sensitive",
      },
      requestBody: requestBody("MfaVerificationConfirmRequest", {
        scope: "mfa-management",
        factor: "email",
        code: "123456",
      }),
      responses: {
        "200": successResponse(
          200,
          "Verification confirmed.",
          "MfaVerificationConfirmResult",
          {
            verified: true,
            scope: "mfa-management",
            factor: "email",
            verifiedUntil: "2026-07-20T18:30:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/auth/mfa/verify/dev/otp",
      operationId: "previewMfaEmailOtp",
      summary: "Preview the current MFA email OTP (development only)",
      description:
        "Returns the active email step-up OTP for the signed-in session. This route is only registered in non-production environments to aid local testing and must not be relied upon in production.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "scope",
          { type: "string", enum: ["mfa-management", "device-login"] },
          "Step-up verification scope.",
          "mfa-management",
          true,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "MfaVerificationPreviewResult",
          {
            scope: "mfa-management",
            factor: "email",
            code: "123456",
            expiresInSeconds: 300,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/auth/mfa/totp/status",
      operationId: "getMfaTotpStatus",
      summary: "Get authenticator (TOTP) status",
      description:
        "Returns whether the signed-in user has an authenticator app (TOTP) enabled.",
      tags: ["mfa"],
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
          "MfaTotpStatusResult",
          { enabled: false },
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/mfa/totp/begin",
      operationId: "beginMfaTotpEnrollment",
      summary: "Begin authenticator (TOTP) enrollment",
      description:
        "Starts authenticator enrollment and returns the shared secret and otpauth provisioning URI. Requires a recent MFA step-up verification for the management scope.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("MfaTotpBeginRequest", {
        accountName: "owner-one@rentify.local",
      }),
      responses: {
        "200": successResponse(
          200,
          "Authenticator enrollment started.",
          "MfaTotpBeginResult",
          {
            secret: "JBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/Rentify:owner-one@rentify.local?secret=JBSWY3DPEHPK3PXP&issuer=Rentify",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/mfa/totp/confirm",
      operationId: "confirmMfaTotpEnrollment",
      summary: "Confirm authenticator (TOTP) enrollment",
      description:
        "Confirms authenticator enrollment with a code from the authenticator app. Requires a recent MFA step-up verification for the management scope.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("MfaTotpConfirmRequest", {
        code: "123456",
      }),
      responses: {
        "200": successResponse(
          200,
          "Authenticator app enabled.",
          "MfaTotpConfirmResult",
          { confirmed: true },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/auth/mfa/totp/disable",
      operationId: "disableMfaTotp",
      summary: "Disable authenticator (TOTP)",
      description:
        "Disables the authenticator app for the signed-in user. Requires a recent MFA step-up verification for the management scope.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("MfaTotpDisableRequest", {}),
      responses: {
        "200": successResponse(
          200,
          "Authenticator app disabled.",
          "MfaTotpDisableResult",
          { disabled: true },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/auth/mfa/totp/pending",
      operationId: "cancelMfaTotpEnrollment",
      summary: "Cancel a pending authenticator (TOTP) enrollment",
      description:
        "Cancels an in-progress, unconfirmed authenticator enrollment. Requires a recent MFA step-up verification for the management scope.",
      tags: ["mfa"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      responses: {
        "200": successResponse(
          200,
          "Pending authenticator enrollment cancelled.",
          "MfaTotpPendingCancelResult",
          { cancelled: true },
        ),
        ...commonErrors([401, 403, 429, 500]),
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
      path: "/organizations",
      operationId: "listPublicOrganizations",
      summary: "List public organizations",
      description:
        "Returns the public organization directory. Only organizations with at least one published posting are included.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 100, default: 20 },
          "Number of organizations to return per page.",
          20,
        ),
        queryParam(
          "q",
          { type: "string", maxLength: 100 },
          "Optional case-insensitive organization name search query.",
          "north",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PublicOrganizationListResult",
          publicOrganizationListExample,
        ),
        ...commonErrors([400, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations",
      operationId: "createOrganization",
      summary: "Create an organization",
      description:
        "Creates a new organization and makes the signed-in user its primary manager. The new organization becomes the caller's active organization.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      requestBody: requestBody("CreateOrganizationRequest", {
        name: "Northwind",
      }),
      responses: {
        "201": successResponse(
          201,
          "Organization created successfully.",
          "CreateOrganizationResult",
          {
            organization: organizationSummaryExample,
            membership: organizationMembershipSummaryExample,
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
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
      path: "/organizations/:id/workspace",
      operationId: "getOrganizationWorkspaceById",
      summary: "Get organization workspace detail",
      description:
        "Returns organization profile, roster, and pending invitations for a signed-in member of the organization.",
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
          "OrganizationWorkspaceDetailResult",
          organizationWorkspaceDetailExample,
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/by-slug/:slug",
      operationId: "resolveOrganizationBySlug",
      summary: "Resolve a public organization URL slug",
      description:
        'Maps a public URL slug onto an organization id. Retired slugs continue to resolve and report `matchedBy: "alias"`, so clients can redirect to `canonicalSlug`. The slug must be in canonical form; a non-canonical reference returns 400 and should be normalized and retried.',
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam(
          "slug",
          "Organization URL slug, current or retired.",
          "northwind",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ResolvedOrganizationReference",
          {
            organizationId: "org-1",
            canonicalSlug: "northwind",
            name: "Northwind",
            matchedBy: "canonical-slug",
          },
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id",
      operationId: "getPublicOrganizationById",
      summary: "Get public organization detail",
      description:
        "Returns the public organization profile and published posting count. Organizations without published postings return 404.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "PublicOrganizationDetailResult",
          publicOrganizationDetailExample,
        ),
        ...commonErrors([400, 404, 429, 500]),
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
      method: "patch",
      path: "/organizations/:id/slug",
      operationId: "updateOrganizationSlug",
      summary: "Change an organization's public URL",
      description:
        "Adopts a new public URL slug and retires the previous one as a permanent alias, so existing links keep resolving. A slug held by another organization, including as one of its retired aliases, is rejected with 409. Only the primary manager can change the URL.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("UpdateOrganizationSlugRequest", {
        slug: "northwind-creative",
      }),
      responses: {
        "200": successResponse(
          200,
          "Organization URL updated successfully.",
          "OrganizationSummary",
          {
            ...organizationSummaryExample,
            slug: "northwind-creative",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
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
      method: "get",
      path: "/organizations/:id/audit",
      operationId: "listOrganizationAudit",
      summary: "List organization audit trail",
      description:
        "Returns a paginated, filterable audit timeline for organization managers. Operators receive 403 Forbidden and non-members receive not found behavior through the membership guard.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of audit records per page.",
          20,
        ),
        queryParam(
          "action",
          schemaRef("OrganizationAuditAction"),
          "Optional audit action filter.",
          "posting.published",
        ),
        queryParam(
          "resourceType",
          schemaRef("OrganizationAuditResourceType"),
          "Optional audited resource type filter.",
          "posting",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationAuditListResult",
          organizationAuditListExample,
          "Organization audit entries returned successfully.",
          {
            requestId: requestIdExample,
            pagination: organizationAuditListExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/audit/:auditId/restore",
      operationId: "restoreOrganizationAuditEntry",
      summary: "Restore an audited organization version",
      description:
        "Applies a manager-only compensating restore from a restorable audit snapshot. Restore never rewrites history; success creates a new restored audit entry. Conflict responses are returned when the target resource no longer exists or the restore would violate current business rules.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "auditId",
          "Organization audit entry identifier.",
          "audit-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Organization version restored successfully.",
          "RestoreOrganizationAuditResult",
          organizationAuditRestoreExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/announcements",
      operationId: "listOrganizationAnnouncements",
      summary: "List organization announcements",
      description:
        "Returns paginated announcements for organization members. Managers see drafts and published announcements; operators and read-only members only receive published announcements.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager", "operator"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of announcements per page.",
          20,
        ),
        queryParam(
          "status",
          schemaRef("OrganizationAnnouncementStatus"),
          "Optional announcement status filter (managers only).",
          "published",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationAnnouncementListResult",
          organizationAnnouncementListExample,
          "Organization announcements returned successfully.",
          {
            requestId: requestIdExample,
            pagination: organizationAnnouncementListExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/announcements",
      operationId: "createOrganizationAnnouncement",
      summary: "Create an organization announcement",
      description:
        "Creates a new announcement for the organization. Only primary managers and managers can create announcements.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("CreateOrganizationAnnouncementRequest", {
        title: "Summer availability update",
        body: "Our downtown studios now accept weekend bookings.",
        status: "published",
      }),
      responses: {
        "201": successResponse(
          201,
          "Organization announcement created successfully.",
          "OrganizationAnnouncementRecord",
          organizationAnnouncementExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/organizations/:id/announcements/:announcementId",
      operationId: "updateOrganizationAnnouncement",
      summary: "Update an organization announcement",
      description:
        "Updates an existing announcement. Only primary managers and managers can update announcements. Changing status to published records a publish event in the audit trail.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "announcementId",
          "Organization announcement identifier.",
          "announcement-1",
        ),
      ],
      requestBody: requestBody("UpdateOrganizationAnnouncementRequest", {
        status: "published",
      }),
      responses: {
        "200": successResponse(
          200,
          "Organization announcement updated successfully.",
          "OrganizationAnnouncementRecord",
          organizationAnnouncementExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/announcements/:announcementId",
      operationId: "deleteOrganizationAnnouncement",
      summary: "Delete an organization announcement",
      description:
        "Deletes an announcement. Only primary managers and managers can delete announcements.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "announcementId",
          "Organization announcement identifier.",
          "announcement-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Organization announcement deleted successfully.",
          "DeleteOrganizationAnnouncementResult",
          {
            deleted: true,
            announcementId: "announcement-1",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/blog",
      operationId: "searchPublicBlogFeed",
      summary: "Search the global organization blog feed",
      description:
        "Returns paginated, published blog posts across all organizations. This is a public, unauthenticated marketing endpoint backed by Elasticsearch (with a database fallback); each result carries a minimal organization summary. Draft posts are never returned.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of blog posts per page.",
          20,
        ),
        queryParam(
          "tag",
          { type: "string" },
          "Optional tag filter.",
          "announcement",
        ),
        queryParam(
          "q",
          { type: "string", minLength: 1, maxLength: 200 },
          "Optional free-text search over the post title, excerpt, body, and tags.",
          "weekend stays",
        ),
        queryParam(
          "sort",
          {
            type: "string",
            enum: ["relevance", "newest", "oldest"],
          },
          "Result ordering. 'relevance' only differs from 'newest' when a query is present.",
          "relevance",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationBlogPostListResult",
          organizationBlogPostListExample,
          "Organization blog posts returned successfully.",
          {
            requestId: requestIdExample,
            pagination: organizationBlogPostListExample.pagination,
          },
        ),
        ...commonErrors([400, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/blog",
      operationId: "listPublicOrganizationBlogPosts",
      summary: "List published organization blog posts",
      description:
        "Returns paginated, published blog posts for an organization. This is a public, unauthenticated marketing endpoint; draft posts are never returned. Backed by Elasticsearch (with a database fallback) so an optional free-text query is supported.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of blog posts per page.",
          20,
        ),
        queryParam(
          "tag",
          { type: "string" },
          "Optional tag filter.",
          "announcement",
        ),
        queryParam(
          "q",
          { type: "string", minLength: 1, maxLength: 200 },
          "Optional free-text search over the post title, excerpt, body, and tags.",
          "weekend stays",
        ),
        queryParam(
          "sort",
          {
            type: "string",
            enum: ["relevance", "newest", "oldest"],
          },
          "Result ordering. 'relevance' only differs from 'newest' when a query is present.",
          "relevance",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationBlogPostListResult",
          organizationBlogPostListExample,
          "Organization blog posts returned successfully.",
          {
            requestId: requestIdExample,
            pagination: organizationBlogPostListExample.pagination,
          },
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/blog/:slug",
      operationId: "getPublicOrganizationBlogPost",
      summary: "Get a published organization blog post by slug",
      description:
        "Returns a single published blog post by its slug. This is a public, unauthenticated marketing endpoint; draft posts return 404.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam("slug", "Blog post slug.", "introducing-weekend-stays"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationBlogPostRecord",
          organizationBlogPostExample,
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/blog/:slug/comments",
      operationId: "listOrganizationBlogComments",
      summary: "List comments on a published blog post",
      description:
        "Returns paginated comments for a published blog post, newest first, so page 1 holds the most recent replies and paging walks backwards into history. This is a public, unauthenticated endpoint; draft posts return 404. Authentication is optional and only affects the envelope: a signed-in reader receives `viewerCanComment`, `viewerCanModerate`, and `viewerUserId` resolved for them. Deleted comments are returned as tombstones with an empty `body` and a `deletedBy` of `author` or `moderator`.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam("slug", "Blog post slug.", "introducing-weekend-stays"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of comments per page.",
          20,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationBlogCommentListResult",
          organizationBlogCommentListExample,
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/blog/:slug/comments",
      operationId: "createOrganizationBlogComment",
      summary: "Post a comment on a blog post",
      description:
        "Posts a comment on a published blog post. Any signed-in user may comment. Returns 409 when comments are closed on the post, which applies to organization managers too, or when the author exceeds their per-account write budget. Bodies are plain text and are rejected if they contain markup.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam("slug", "Blog post slug.", "introducing-weekend-stays"),
      ],
      requestBody: requestBody("CreateOrganizationBlogCommentRequest", {
        body: "This is exactly what we needed for the weekend.",
      }),
      responses: {
        "201": successResponse(
          201,
          "Comment posted successfully.",
          "OrganizationBlogCommentRecord",
          organizationBlogCommentExample,
        ),
        ...commonErrors([400, 401, 404, 409, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/blog/:slug/comments/socket-ticket",
      operationId: "createOrganizationBlogCommentSocketTicket",
      summary: "Issue a blog comment socket ticket",
      description:
        "Issues a short-lived, single-use ticket for the blog comment WebSocket. A browser `WebSocket` cannot send an `authorization` header, so the session is exchanged here and the ticket is returned as an HttpOnly cookie scoped to `/ws/blog-comments`, which the browser then sends automatically on the upgrade. The ticket never appears in the response body or a query string, and is consumed on first use after 30 seconds. Authentication is optional: an unauthenticated caller receives a read-only ticket, which is what lets anonymous visitors receive comments live. The socket itself is not an HTTP operation and is therefore not described here; it emits `ready`, `comment.created`, `comment.updated`, `comment.deleted`, `typing`, `presence`, `comments.closed`, and `resync` frames, and accepts `typing` frames from signed-in clients. PAT bearer authentication is not allowed.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam("slug", "Blog post slug.", "introducing-weekend-stays"),
      ],
      responses: {
        "201": successResponse(
          201,
          "Socket ticket issued successfully.",
          "OrganizationBlogCommentSocketTicket",
          { expiresInSeconds: 30 },
        ),
        ...commonErrors([400, 403, 404, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/organizations/:id/blog/:slug/comments/:commentId",
      operationId: "updateOrganizationBlogComment",
      summary: "Edit your own blog comment",
      description:
        "Edits a comment. Only its author may edit, and only within 15 minutes of posting; organization managers remove comments rather than rewriting them, and receive 403 here. Returns 409 when the window has closed, when the comment was deleted concurrently, or when comments are closed on the post.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam("slug", "Blog post slug.", "introducing-weekend-stays"),
        routePathParam("commentId", "Comment identifier.", "blog-comment-1"),
      ],
      requestBody: requestBody("UpdateOrganizationBlogCommentRequest", {
        body: "This is exactly what we needed for the weekend. Thank you!",
      }),
      responses: {
        "200": successResponse(
          200,
          "Comment updated successfully.",
          "OrganizationBlogCommentRecord",
          organizationBlogCommentExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/blog/:slug/comments/:commentId",
      operationId: "deleteOrganizationBlogComment",
      summary: "Remove a blog comment",
      description:
        "Soft-deletes a comment. The author may remove their own at any time; managers of the owning organization may remove any comment on their post. The row survives as a tombstone with an empty `body`, so the thread keeps its shape and any content report still resolves. A second delete returns 404.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam("slug", "Blog post slug.", "introducing-weekend-stays"),
        routePathParam("commentId", "Comment identifier.", "blog-comment-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Comment removed successfully.",
          "OrganizationBlogCommentRecord",
          organizationBlogCommentTombstoneExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/blog-posts",
      operationId: "listOrganizationBlogPosts",
      summary: "List organization blog posts (management)",
      description:
        "Returns paginated blog posts for organization members. Managers see drafts and published posts; operators and read-only members only receive published posts.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager", "operator"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of blog posts per page.",
          20,
        ),
        queryParam(
          "status",
          schemaRef("OrganizationBlogStatus"),
          "Optional status filter (managers only).",
          "published",
        ),
        queryParam(
          "tag",
          { type: "string" },
          "Optional tag filter.",
          "downtown",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationBlogPostListResult",
          organizationBlogPostListExample,
          "Organization blog posts returned successfully.",
          {
            requestId: requestIdExample,
            pagination: organizationBlogPostListExample.pagination,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/blog-posts",
      operationId: "createOrganizationBlogPost",
      summary: "Create an organization blog post",
      description:
        "Creates a new blog post. Only primary managers and managers can create posts. The body is sanitized rich-text HTML and a unique slug is derived from the title when not supplied.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("CreateOrganizationBlogPostRequest", {
        title: "Introducing weekend stays at our downtown studios",
        body: "<h2>Weekend stays are here</h2><p>Book any downtown studio for the weekend.</p>",
        excerpt: "Weekend bookings are now open across every downtown studio.",
        tags: ["announcement", "downtown"],
        status: "published",
      }),
      responses: {
        "201": successResponse(
          201,
          "Organization blog post created successfully.",
          "OrganizationBlogPostRecord",
          organizationBlogPostExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/organizations/:id/blog-posts/:blogPostId",
      operationId: "updateOrganizationBlogPost",
      summary: "Update an organization blog post",
      description:
        "Updates an existing blog post. Only primary managers and managers can update posts. Changing status to published records a publish event in the audit trail.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "blogPostId",
          "Organization blog post identifier.",
          "blog-1",
        ),
      ],
      requestBody: requestBody("UpdateOrganizationBlogPostRequest", {
        status: "published",
      }),
      responses: {
        "200": successResponse(
          200,
          "Organization blog post updated successfully.",
          "OrganizationBlogPostRecord",
          organizationBlogPostExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/blog-posts/:blogPostId",
      operationId: "deleteOrganizationBlogPost",
      summary: "Delete an organization blog post",
      description:
        "Deletes a blog post. Only primary managers and managers can delete posts.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "blogPostId",
          "Organization blog post identifier.",
          "blog-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Organization blog post deleted successfully.",
          "DeleteOrganizationBlogPostResult",
          {
            deleted: true,
            blogPostId: "blog-1",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/reviews",
      operationId: "listOrganizationReviews",
      summary: "List organization reviews",
      description:
        "Returns paginated reviews and the aggregate rating summary for an organization. This is a public, unauthenticated endpoint.",
      tags: ["organizations"],
      permissions: {
        authMode: "public",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number to return.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Number of reviews per page.",
          20,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OrganizationReviewListResult",
          organizationReviewListExample,
          "Organization reviews returned successfully.",
          {
            requestId: requestIdExample,
            pagination: organizationReviewListExample.pagination,
          },
        ),
        ...commonErrors([400, 404, 429, 500]),
      },
    },
    {
      method: "get",
      path: "/organizations/:id/reviews/me",
      operationId: "getOwnOrganizationReview",
      summary: "Get your organization review",
      description:
        "Returns the authenticated user's own review for the organization, or null if they have not reviewed it. Useful for deciding whether to create or edit a review regardless of pagination.",
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
          "NullableOrganizationReviewRecord",
          organizationReviewExample,
          "Your organization review returned successfully.",
        ),
        ...commonErrors([400, 401, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/organizations/:id/reviews",
      operationId: "createOrganizationReview",
      summary: "Submit an organization review",
      description:
        "Creates a review for an organization. The reviewer must be authenticated, must not be a member of the organization, and must have at least one completed, non-disputed rental with the organization. Each user may submit one review per organization.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("CreateOrganizationReviewRequest", {
        rating: 5,
        title: "Smooth end-to-end rental",
        comment:
          "Pickup was effortless and the team was responsive throughout.",
      }),
      responses: {
        "201": successResponse(
          201,
          "Review submitted successfully.",
          "OrganizationReviewRecord",
          organizationReviewExample,
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/organizations/:id/reviews/me",
      operationId: "updateOwnOrganizationReview",
      summary: "Update your organization review",
      description:
        "Updates the authenticated reviewer's existing review for the organization. The same eligibility rules as creation apply.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Organization identifier.", "org-1")],
      requestBody: requestBody("UpdateOrganizationReviewRequest", {
        rating: 4,
        title: "Still a great experience",
        comment: "Second rental went just as smoothly as the first.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Review updated successfully.",
          "OrganizationReviewRecord",
          organizationReviewExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/reviews/me",
      operationId: "deleteOwnOrganizationReview",
      summary: "Delete your organization review",
      description:
        "Deletes the authenticated reviewer's own review for the organization.",
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
          "Review deleted successfully.",
          "DeleteOrganizationReviewResult",
          {
            deleted: true,
            reviewId: "review-1",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/organizations/:id/reviews/:reviewId/reply",
      operationId: "replyToOrganizationReview",
      summary: "Reply to an organization review",
      description:
        "Adds or updates a public manager reply to a review. Only primary managers and managers can respond.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "reviewId",
          "Organization review identifier.",
          "review-1",
        ),
      ],
      requestBody: requestBody("ReplyOrganizationReviewRequest", {
        body: "Thank you for renting with us — see you next time!",
      }),
      responses: {
        "200": successResponse(
          200,
          "Reply saved successfully.",
          "OrganizationReviewRecord",
          organizationReviewExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/reviews/:reviewId/reply",
      operationId: "removeOrganizationReviewReply",
      summary: "Remove a reply from an organization review",
      description:
        "Removes the public manager reply from a review. Only primary managers and managers can remove replies.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "reviewId",
          "Organization review identifier.",
          "review-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Reply removed successfully.",
          "OrganizationReviewRecord",
          { ...organizationReviewExample, response: null },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/organizations/:id/reviews/:reviewId",
      operationId: "deleteOrganizationReview",
      summary: "Delete an organization review",
      description:
        "Deletes a review as a moderation action. Only primary managers and managers can delete reviews.",
      tags: ["organizations"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
        organizationRoles: ["primary_manager", "manager"],
      },
      parameters: [
        routePathParam("id", "Organization identifier.", "org-1"),
        routePathParam(
          "reviewId",
          "Organization review identifier.",
          "review-1",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Review deleted successfully.",
          "DeleteOrganizationReviewResult",
          {
            deleted: true,
            reviewId: "review-1",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
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
      method: "delete",
      path: "/blob",
      operationId: "deleteBlob",
      summary: "Delete a managed blob",
      description:
        "Deletes a blob owned by the authenticated user. The target blob is identified by the `blobName` query parameter.",
      tags: ["blob"],
      security: [{ bearerAuth: [] }],
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "blobName",
          { type: "string", maxLength: 1000 },
          "Managed blob name to delete.",
          "postings/user-1/photo-1.jpg",
          true,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Blob deleted successfully.",
          "BlobDeleteResult",
          { deleted: true },
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
      description:
        "Updates the authenticated user's editable profile fields. `username` is required on every call; resending the current value is a no-op. Changing it is limited to once every 30 days and responds `429 USERNAME_CHANGE_COOLDOWN` while the cooldown is in effect. Replacing an OAuth-generated username is exempt and does not start the cooldown.",
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
      path: "/admin/organizations/search/reindex",
      operationId: "startOrganizationSearchReindex",
      summary: "Start an organization search reindex run",
      description:
        "Starts a full organization search reindex. Admin bearer authentication is required.",
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
          "Organization search reindex has been started.",
          "SearchReindexRunRecord",
          searchStatusExample.currentReindexRun,
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/admin/organizations/search/reindex-runs/:id",
      operationId: "getOrganizationSearchReindexRun",
      summary: "Get an organization search reindex run",
      description:
        "Returns the specified organization search reindex run, or `run: null` if the identifier does not exist.",
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
      path: "/admin/organizations/search/status",
      operationId: "getOrganizationSearchStatus",
      summary: "Get organization search subsystem status",
      description:
        "Returns alias status, queue lag, telemetry, and the latest/current reindex state for the organization search index.",
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
      path: "/admin/organizations/search/outbox/replay-dead-lettered",
      operationId: "replayDeadLetteredOrganizationSearchOutbox",
      summary: "Replay dead-lettered organization search outbox entries",
      description:
        "Requeues dead-lettered organization search sync entries. The optional `limit` query controls how many items to revive.",
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
          "Dead-lettered organization search outbox entries are being replayed.",
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
      path: "/admin/organizations/search/cleanup-retained-indices",
      operationId: "cleanupRetainedOrganizationSearchIndices",
      summary: "Delete retained organization search indices",
      description:
        "Deletes retained organization search indices that are no longer needed after reindex completion.",
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
          "Organization search index cleanup has been started.",
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
      path: "/admin/organizations/blog-search/reindex",
      operationId: "startOrganizationBlogSearchReindex",
      summary: "Start an organization blog search reindex run",
      description:
        "Starts a full organization blog search reindex. Admin bearer authentication is required.",
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
          "Organization blog search reindex has been started.",
          "SearchReindexRunRecord",
          searchStatusExample.currentReindexRun,
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/admin/organizations/blog-search/reindex-runs/:id",
      operationId: "getOrganizationBlogSearchReindexRun",
      summary: "Get an organization blog search reindex run",
      description:
        "Returns the specified organization blog search reindex run, or `run: null` if the identifier does not exist.",
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
      path: "/admin/organizations/blog-search/status",
      operationId: "getOrganizationBlogSearchStatus",
      summary: "Get organization blog search subsystem status",
      description:
        "Returns alias status, queue lag, telemetry, and the latest/current reindex state for the organization blog search index.",
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
      path: "/admin/organizations/blog-search/outbox/replay-dead-lettered",
      operationId: "replayDeadLetteredOrganizationBlogSearchOutbox",
      summary: "Replay dead-lettered organization blog search outbox entries",
      description:
        "Requeues dead-lettered organization blog search sync entries. The optional `limit` query controls how many items to revive.",
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
          "Dead-lettered organization blog search outbox entries are being replayed.",
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
      path: "/admin/organizations/blog-search/cleanup-retained-indices",
      operationId: "cleanupRetainedOrganizationBlogSearchIndices",
      summary: "Delete retained organization blog search indices",
      description:
        "Deletes retained organization blog search indices that are no longer needed after reindex completion.",
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
          "Organization blog search index cleanup has been started.",
          "CleanupRetainedSearchIndicesResult",
          {
            deleted: 1,
          },
        ),
        ...commonErrors([401, 403, 429, 500, 503]),
      },
    },
    {
      method: "get",
      path: "/admin/feature-flags",
      operationId: "listFeatureFlags",
      summary: "List resolved feature flags",
      description:
        "Lists all resolved feature flags, merging database overrides, environment values, and code defaults. Admin bearer authentication is required.",
      tags: ["feature-flags"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      parameters: [
        queryParam(
          "enabled",
          { type: "string", enum: ["true", "false"] },
          "Filter by resolved enabled state.",
          "true",
        ),
        queryParam(
          "search",
          { type: "string" },
          "Filter by flag name or description substring.",
          "checkout",
        ),
        queryParam(
          "group",
          { type: "string" },
          "Filter by flag group.",
          "payments",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "FeatureFlagListResult",
          [
            {
              name: "payments.new-checkout",
              enabled: true,
              source: "db",
              description: "Enables the redesigned checkout flow.",
              group: "payments",
            },
            {
              name: "search.elasticsearch",
              enabled: false,
              source: "default",
              description: null,
              group: "search",
            },
          ],
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "put",
      path: "/admin/feature-flags/:name",
      operationId: "setFeatureFlag",
      summary: "Create or update a feature-flag override",
      description:
        "Upserts a database override for the named feature flag, records an audit-log entry, and invalidates the flag cache. Admin bearer authentication is required.",
      tags: ["feature-flags"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      parameters: [
        routePathParam("name", "Feature-flag name.", "payments.new-checkout"),
      ],
      requestBody: requestBody("SetFeatureFlagRequest", {
        enabled: true,
        description: "Enables the redesigned checkout flow.",
        group: "payments",
      }),
      responses: {
        "200": successResponse(
          200,
          "Feature flag updated successfully.",
          "ResolvedFeatureFlag",
          {
            name: "payments.new-checkout",
            enabled: true,
            source: "db",
            description: "Enables the redesigned checkout flow.",
            group: "payments",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/admin/feature-flags/:name",
      operationId: "deleteFeatureFlag",
      summary: "Delete a feature-flag override",
      description:
        "Removes the database override for the named feature flag so it falls back to the environment value or code default. The deletion is audit-logged. Admin bearer authentication is required.",
      tags: ["feature-flags"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "admin",
        patAllowed: false,
      },
      parameters: [
        routePathParam("name", "Feature-flag name.", "payments.new-checkout"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Feature flag override removed successfully.",
          "DeleteFeatureFlagResult",
          {
            name: "payments.new-checkout",
            deletedOverride: true,
            effectiveEnabled: false,
            effectiveSource: "default",
          },
        ),
        ...commonErrors([400, 401, 403, 429, 500]),
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
        queryParam(
          "q",
          { type: "string", minLength: 1, maxLength: 120 },
          "Optional case-insensitive search across posting name and description.",
          "studio",
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
      path: "/postings/me/summary",
      operationId: "ownPostingsStatusSummary",
      summary: "Count the owner's postings by status",
      description:
        "Returns the total number of postings for the active organization and a per-status breakdown. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "owner",
        patAllowed: true,
        patScope: "mcp:read",
      },
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "OwnerPostingsStatusSummary",
          {
            total: 7,
            byStatus: { draft: 2, published: 3, paused: 1, archived: 1 },
          },
        ),
        ...commonErrors([401, 403, 429, 500]),
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
      path: "/postings/analytics/export",
      operationId: "exportPostingAnalytics",
      summary: "Export owner analytics as CSV",
      description:
        "Streams owner-level posting analytics for the selected reporting window as a downloadable CSV file. PAT bearer authentication with `mcp:read` is allowed.",
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
        "200": {
          description: "Analytics CSV exported successfully.",
          content: {
            "text/csv": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
          },
        },
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
      method: "get",
      path: "/postings/:id/reviews/me",
      operationId: "getOwnPostingReview",
      summary: "Get the caller's review state for a posting",
      description:
        "Returns whether the authenticated caller may review this posting and their existing review, or null if they have not reviewed it. Useful for deciding whether to create or edit a review regardless of pagination. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "GetOwnPostingReviewResult",
          {
            eligible: true,
            review: reviewExample,
          },
          "Successful response.",
        ),
        ...commonErrors([400, 401, 404, 429, 500]),
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
      method: "get",
      path: "/postings/saved",
      operationId: "listSavedPostings",
      summary: "List the caller's saved postings",
      description:
        "Returns the authenticated caller's saved postings as public posting snapshots, newest save first. Postings that stopped being publicly viewable after they were saved are reported in `unavailablePostings`, with the name and the reason, instead of `postings`, so a page can contain fewer entries than `pageSize`. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt-or-pat",
        minimumRole: "user",
        patAllowed: true,
        patScope: "mcp:read",
      },
      parameters: [parameterRef("Page"), parameterRef("PageSize")],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "ListSavedPostingsResult",
          savedPostingsResultExample,
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
      path: "/postings/saved/ids",
      operationId: "listSavedPostingIds",
      summary: "List the caller's saved posting identifiers",
      description:
        "Returns only the identifiers of the authenticated caller's saved postings so a client can render saved state across a list of postings with a single request. The set is capped; when `truncated` is true the caller has more saved postings than the response carries. PAT bearer authentication with `mcp:read` is allowed.",
      tags: ["postings"],
      security: ownerSecurity,
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
          "ListSavedPostingIdsResult",
          savedPostingIdsResultExample,
          "Successful response.",
        ),
        ...commonErrors([401, 403, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/save",
      operationId: "savePosting",
      summary: "Save a posting",
      description:
        "Adds a publicly visible posting to the authenticated caller's saved postings. The operation is idempotent: saving an already saved posting succeeds and preserves the original save time.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Posting saved successfully.",
          "SavedPostingState",
          savedPostingStateExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/postings/:id/save",
      operationId: "unsavePosting",
      summary: "Remove a posting from saved postings",
      description:
        "Removes a posting from the authenticated caller's saved postings. The operation is idempotent and succeeds even when the posting was never saved, or is no longer publicly visible, so bookmarks cannot become stuck.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Posting removed from saved postings.",
          "SavedPostingState",
          {
            ...savedPostingStateExample,
            saved: false,
            savedAt: null,
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
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
            enum: [
              "posting",
              "posting_review",
              "user",
              "organization_blog_comment",
            ],
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
      path: "/postings/:id/availability-calendar",
      operationId: "getPostingAvailabilityCalendar",
      summary: "Get a posting's availability calendar",
      description:
        "Returns day-by-day availability for the requested month, combining posting availability status, advance notice, owner availability blocks, active booking holds, and confirmed rentings. The response maps each `YYYY-MM-DD` day (in the requested timezone) to its status. Authentication is optional; owners may preview the calendar of their own non-published posting.",
      tags: ["postings"],
      security: optionalSecurity,
      permissions: {
        authMode: "optional-bearer",
        minimumRole: null,
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        queryParam(
          "year",
          { type: "integer", minimum: 2000, maximum: 2100 },
          "Four-digit calendar year of the requested month.",
          2026,
          true,
        ),
        queryParam(
          "month",
          { type: "integer", minimum: 1, maximum: 12 },
          "Calendar month (1-12) to compute availability for.",
          7,
          true,
        ),
        queryParam(
          "tz",
          { type: "string" },
          "IANA timezone used for day boundaries and advance-notice calculations. Defaults to UTC.",
          "America/Toronto",
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "AvailabilityCalendarResult",
          {
            "2026-07-01": { status: "available", validStart: true },
            "2026-07-02": { status: "blocked", reason: "Owner maintenance" },
            "2026-07-03": { status: "booked", reason: "booked" },
            "2026-07-04": { status: "unavailable", reason: "advance_notice" },
          },
        ),
        ...commonErrors([400, 404, 429, 500]),
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
      method: "get",
      path: "/postings/:id/seasonal-pricing",
      operationId: "listPostingSeasonalPricing",
      summary: "List seasonal pricing rules",
      description:
        "Returns all seasonal pricing rules for the selected posting.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt",
        minimumRole: "owner",
        patAllowed: false,
        patScope: null,
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      responses: {
        "200": successResponse(
          200,
          "Seasonal pricing rules retrieved.",
          "SeasonalPricingRuleList",
          [],
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/postings/:id/seasonal-pricing",
      operationId: "createPostingSeasonalPricingRule",
      summary: "Create a seasonal pricing rule",
      description:
        "Creates a seasonal pricing rule for the selected posting. Max 20 rules per posting.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt",
        minimumRole: "owner",
        patAllowed: false,
        patScope: null,
      },
      parameters: [routePathParam("id", "Posting identifier.", "posting-1")],
      requestBody: requestBody("SeasonalPricingRuleRequest", {
        name: "Summer Peak",
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        dailyAmount: 150,
      }),
      responses: {
        "201": successResponse(
          201,
          "Seasonal pricing rule created.",
          "SeasonalPricingRule",
          {
            id: "rule-1",
            postingId: "posting-1",
            name: "Summer Peak",
            startDate: "2026-06-01",
            endDate: "2026-08-31",
            dailyAmount: 150,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 409, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/postings/:id/seasonal-pricing/:ruleId",
      operationId: "updatePostingSeasonalPricingRule",
      summary: "Update a seasonal pricing rule",
      description: "Updates a seasonal pricing rule for the selected posting.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt",
        minimumRole: "owner",
        patAllowed: false,
        patScope: null,
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        routePathParam("ruleId", "Seasonal pricing rule identifier.", "rule-1"),
      ],
      requestBody: requestBody("SeasonalPricingRuleRequest", {
        name: "Summer Peak",
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        dailyAmount: 175,
      }),
      responses: {
        "200": successResponse(
          200,
          "Seasonal pricing rule updated.",
          "SeasonalPricingRule",
          {
            id: "rule-1",
            postingId: "posting-1",
            name: "Summer Peak",
            startDate: "2026-06-01",
            endDate: "2026-08-31",
            dailyAmount: 175,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-02T00:00:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/postings/:id/seasonal-pricing/:ruleId",
      operationId: "deletePostingSeasonalPricingRule",
      summary: "Delete a seasonal pricing rule",
      description: "Deletes a seasonal pricing rule for the selected posting.",
      tags: ["postings"],
      security: ownerSecurity,
      permissions: {
        authMode: "jwt",
        minimumRole: "owner",
        patAllowed: false,
        patScope: null,
      },
      parameters: [
        routePathParam("id", "Posting identifier.", "posting-1"),
        routePathParam("ruleId", "Seasonal pricing rule identifier.", "rule-1"),
      ],
      responses: {
        "204": noContentResponse("Seasonal pricing rule deleted successfully."),
        ...commonErrors([401, 403, 404, 429, 500]),
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
          "organization",
          { type: "string", minLength: 1, maxLength: 160 },
          "Filter by owning organization name. Matched case-insensitively: exact matches rank first, then prefix, then substring, capped at 25 organizations. Ignored when `organizationId` is supplied.",
          "Maya Santos Organization",
        ),
        queryParam(
          "organizationId",
          {
            type: "string",
            // GUID shape rather than `format: uuid`: identifiers are stored as
            // VarChar(36) and are not required to carry RFC 4122 version and
            // variant bits, so an SDK or gateway enforcing `format: uuid`
            // would reject ids this endpoint accepts.
            pattern:
              "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
          },
          "Filter by exact owning organization id. Takes precedence over `organization`. Accepts any 8-4-4-4-12 hexadecimal identifier, which includes but is not limited to RFC 4122 UUIDs.",
          "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f",
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
              "highestRated",
              "organizationAsc",
              "organizationDesc",
            ],
            default: "relevance",
          },
          "Sort order. `organizationAsc`/`organizationDesc` order by owning organization name.",
          "relevance",
        ),
        queryParam(
          "cancellationPolicy",
          { type: "string", enum: ["flexible", "moderate", "strict"] },
          "Cancellation policy filter.",
          "flexible",
        ),
        queryParam(
          "instantBooking",
          { type: "boolean" },
          "Restrict to postings that support instant booking.",
          true,
        ),
        queryParam(
          "maxMinBookingDurationDays",
          { type: "integer", minimum: 1 },
          "Only return postings whose minimum booking duration is at most this many days.",
          3,
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
        "Creates a booking request for the selected posting. On a standard posting the request starts in `pending` and awaits owner approval. On an instant-book posting it is auto-approved on creation and returned in `awaiting_payment` with `autoApproved: true`. PAT bearer authentication with `mcp:write` is allowed.",
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
          bookingRequestPendingExample,
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
      method: "get",
      path: "/booking-requests/:id/messages",
      operationId: "listBookingMessages",
      summary: "List booking request messages",
      description:
        "Returns the paginated message thread for a booking request, newest first, plus the unread count for the requesting side. Readable by the renter and by any member of the owning organization. PAT bearer authentication is not allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
        queryParam(
          "page",
          { type: "integer", minimum: 1, default: 1 },
          "Page number.",
          1,
        ),
        queryParam(
          "pageSize",
          { type: "integer", minimum: 1, maximum: 50, default: 20 },
          "Messages per page.",
          20,
        ),
      ],
      responses: {
        "200": successResponse(
          200,
          "Request completed successfully.",
          "BookingMessagesListResult",
          {
            messages: [bookingMessageExample],
            pagination: {
              page: 1,
              pageSize: 20,
              total: 1,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
            unreadCount: 1,
            canWrite: true,
            counterpartName: "renter-one",
            viewerSide: "owner",
          },
          "Successful response.",
          {
            requestId: requestIdExample,
            pagination: {
              page: 1,
              pageSize: 20,
              total: 1,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/messages",
      operationId: "sendBookingMessage",
      summary: "Send a booking request message",
      description:
        "Sends a message on a booking request thread. Allowed for the renter and for organization managers; organization operators are read-only. Queues a notification email to the other party, throttled per thread. PAT bearer authentication is not allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      requestBody: requestBody("SendBookingMessageRequest", {
        body: "The keys will be in the lockbox by the front door.",
      }),
      responses: {
        "201": successResponse(
          201,
          "Message sent successfully.",
          "BookingMessageRecord",
          bookingMessageExample,
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "patch",
      path: "/booking-requests/:id/messages/:messageId",
      operationId: "editBookingMessage",
      summary: "Edit a booking request message",
      description:
        "Edits the authenticated user's own message. Allowed within 15 minutes of sending, regardless of whether the other party has read it, and the edit is marked so the other side can see the message changed. PAT bearer authentication is not allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
        routePathParam("messageId", "Message identifier.", "booking-message-1"),
      ],
      requestBody: requestBody("SendBookingMessageRequest", {
        body: "The keys will be in the lockbox by the side door.",
      }),
      responses: {
        "200": successResponse(
          200,
          "Message updated successfully.",
          "BookingMessageRecord",
          {
            ...bookingMessageExample,
            body: "The keys will be in the lockbox by the side door.",
            editedAt: "2026-05-26T08:02:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "delete",
      path: "/booking-requests/:id/messages/:messageId",
      operationId: "deleteBookingMessage",
      summary: "Delete a booking request message",
      description:
        "Deletes the authenticated user's own message within 15 minutes of sending. The message is soft deleted: its text is cleared but the row remains so the booking keeps a record that a message existed. PAT bearer authentication is not allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
        routePathParam("messageId", "Message identifier.", "booking-message-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Message deleted successfully.",
          "BookingMessageRecord",
          {
            ...bookingMessageExample,
            body: "",
            deletedAt: "2026-05-26T08:05:00.000Z",
          },
        ),
        ...commonErrors([400, 401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/messages/read",
      operationId: "markBookingMessagesRead",
      summary: "Mark booking request messages as read",
      description:
        "Marks every unread message addressed to the authenticated user's side of the thread as read. Read state is tracked per side, not per user, so an organization manager clears it for the whole organization. PAT bearer authentication is not allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      responses: {
        "200": successResponse(
          200,
          "Messages marked as read.",
          "MarkBookingMessagesReadResult",
          {
            bookingRequestId: "booking-1",
            markedCount: 2,
            readAt: "2026-05-26T08:05:00.000Z",
          },
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
      },
    },
    {
      method: "post",
      path: "/booking-requests/:id/messages/socket-ticket",
      operationId: "createBookingMessageSocketTicket",
      summary: "Issue a booking message socket ticket",
      description:
        "Issues a short-lived, single-use ticket for the booking message WebSocket. A browser `WebSocket` cannot send an `authorization` header, so the bearer token is exchanged here and the ticket is returned as an HttpOnly cookie scoped to `/ws/booking-messages`, which the browser then sends automatically on the upgrade. The ticket never appears in the response body or a query string, and is consumed on first use after 30 seconds. The socket itself is not an HTTP operation and is therefore not described here; it emits `ready`, `message.created`, `message.updated`, `messages.read`, `messages.delivered`, `typing`, and `presence` frames, and accepts `typing`, `delivered`, and `ping` frames from the client. PAT bearer authentication is not allowed.",
      tags: ["booking-requests"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
      responses: {
        "201": successResponse(
          201,
          "Socket ticket issued successfully.",
          "BookingMessageSocketTicket",
          { expiresInSeconds: 30 },
        ),
        ...commonErrors([401, 403, 404, 429, 500]),
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
      method: "post",
      path: "/sms/webhooks/telnyx",
      operationId: "handleTelnyxSmsWebhook",
      summary: "Handle a Telnyx SMS webhook",
      description:
        "Processes a Telnyx messaging webhook. The `telnyx-signature-ed25519` and `telnyx-timestamp` headers are required and verified against the raw request body.",
      tags: ["sms"],
      security: [{ telnyxWebhookSignature: [], telnyxWebhookTimestamp: [] }],
      permissions: {
        authMode: "webhook-signature",
        minimumRole: null,
        patAllowed: false,
      },
      requestBody: {
        required: true,
        description: "Telnyx messaging webhook payload.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: true,
            },
            example: {
              data: {
                id: "event-1",
                event_type: "message.sent",
                occurred_at: "2026-06-21T12:00:00.000Z",
                payload: {
                  id: "telnyx-message-1",
                  direction: "outbound",
                  from: {
                    phone_number: "+14165550199",
                  },
                  to: [
                    {
                      phone_number: "+14165550100",
                      status: "queued",
                    },
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        "200": successResponse(
          200,
          "SMS webhook processed successfully.",
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
      method: "get",
      path: "/booking-requests/:id/payment",
      operationId: "getPaymentByBookingRequest",
      summary: "Get a payment by booking request ID",
      description:
        "Returns the payment record associated with a booking request when the authenticated caller is allowed to access it.",
      tags: ["payments"],
      security: ownerSecurity,
      permissions: {
        authMode: "session-bearer",
        minimumRole: "user",
        patAllowed: false,
      },
      parameters: [
        routePathParam("id", "Booking request identifier.", "booking-1"),
      ],
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
      telnyxWebhookSignature: {
        type: "apiKey",
        in: "header",
        name: "telnyx-signature-ed25519",
      },
      telnyxWebhookTimestamp: {
        type: "apiKey",
        in: "header",
        name: "telnyx-timestamp",
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
        required: ["id", "slug", "name", "role"],
        properties: {
          id: { type: "string" },
          slug: schemaRef("OrganizationSlug"),
          name: { type: "string" },
          role: schemaRef("OrganizationRole"),
        },
      },
      OrganizationSlug: {
        type: "string",
        description:
          "Public URL identifier. Lowercase letters, numbers, and single hyphens.",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        minLength: 2,
        maxLength: 160,
        example: "northwind",
      },
      ResolvedOrganizationReference: {
        type: "object",
        required: ["organizationId", "canonicalSlug", "name", "matchedBy"],
        properties: {
          organizationId: { type: "string" },
          canonicalSlug: schemaRef("OrganizationSlug"),
          name: { type: "string" },
          matchedBy: {
            type: "string",
            enum: ["canonical-slug", "alias"],
            description:
              "`alias` means the request used a retired slug; clients should redirect to `canonicalSlug`.",
          },
        },
      },
      UpdateOrganizationSlugRequest: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: schemaRef("OrganizationSlug"),
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
      OrganizationProfileFields: {
        type: "object",
        properties: {
          description: { type: "string", maxLength: 5000, nullable: true },
          websiteUrl: {
            type: "string",
            format: "uri",
            maxLength: 500,
            nullable: true,
          },
          contactEmail: {
            type: "string",
            format: "email",
            maxLength: 320,
            nullable: true,
          },
          contactPhone: { type: "string", maxLength: 40, nullable: true },
          addressLine1: { type: "string", maxLength: 200, nullable: true },
          addressLine2: { type: "string", maxLength: 200, nullable: true },
          city: { type: "string", maxLength: 120, nullable: true },
          region: { type: "string", maxLength: 120, nullable: true },
          country: { type: "string", maxLength: 120, nullable: true },
          postalCode: { type: "string", maxLength: 20, nullable: true },
          logoUrl: {
            type: "string",
            format: "uri",
            maxLength: 1024,
            nullable: true,
          },
          logoBlobName: { type: "string", maxLength: 1024, nullable: true },
          customFields: {
            type: "object",
            additionalProperties: { type: "string", maxLength: 1000 },
            nullable: true,
          },
        },
      },
      CreateOrganizationRequest: {
        allOf: [
          {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 160 },
            },
          },
          schemaRef("OrganizationProfileFields"),
        ],
      },
      CreateOrganizationResult: {
        type: "object",
        required: ["organization", "membership"],
        properties: {
          organization: schemaRef("OrganizationSummary"),
          membership: schemaRef("OrganizationMembershipSummary"),
        },
      },
      UpdateOrganizationRequest: {
        allOf: [
          {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 160 },
            },
          },
          schemaRef("OrganizationProfileFields"),
        ],
      },
      PublicOrganizationProfileFields: {
        type: "object",
        properties: {
          description: { type: "string", maxLength: 5000, nullable: true },
          websiteUrl: {
            type: "string",
            format: "uri",
            maxLength: 500,
            nullable: true,
          },
          addressLine1: { type: "string", maxLength: 200, nullable: true },
          addressLine2: { type: "string", maxLength: 200, nullable: true },
          city: { type: "string", maxLength: 120, nullable: true },
          region: { type: "string", maxLength: 120, nullable: true },
          country: { type: "string", maxLength: 120, nullable: true },
          postalCode: { type: "string", maxLength: 20, nullable: true },
          logoUrl: {
            type: "string",
            format: "uri",
            maxLength: 1024,
            nullable: true,
          },
          customFields: {
            type: "object",
            additionalProperties: { type: "string", maxLength: 1000 },
            nullable: true,
          },
        },
      },
      PublicOrganizationStats: {
        type: "object",
        required: ["publishedPostingCount"],
        properties: {
          publishedPostingCount: { type: "integer", minimum: 0 },
        },
      },
      PublicOrganizationSummary: {
        allOf: [
          {
            type: "object",
            required: [
              "id",
              "slug",
              "name",
              "createdAt",
              "updatedAt",
              "publishedPostingCount",
            ],
            properties: {
              id: { type: "string" },
              slug: schemaRef("OrganizationSlug"),
              name: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
              publishedPostingCount: { type: "integer", minimum: 0 },
            },
          },
          schemaRef("PublicOrganizationProfileFields"),
        ],
      },
      PublicOrganizationListResult: {
        type: "object",
        required: ["organizations", "pagination"],
        properties: {
          organizations: {
            type: "array",
            items: schemaRef("PublicOrganizationSummary"),
          },
          pagination: schemaRef("Pagination"),
          query: { type: "string" },
        },
      },
      PublicOrganizationDetailResult: {
        type: "object",
        required: ["organization", "stats"],
        properties: {
          organization: schemaRef("PublicOrganizationSummary"),
          stats: schemaRef("PublicOrganizationStats"),
        },
      },
      OrganizationWorkspaceDetailOrganization: {
        allOf: [
          {
            type: "object",
            required: ["id", "slug", "name", "createdAt", "updatedAt"],
            properties: {
              id: { type: "string" },
              slug: schemaRef("OrganizationSlug"),
              name: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
          schemaRef("OrganizationProfileFields"),
        ],
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
      OrganizationWorkspaceDetailResult: {
        type: "object",
        required: ["organization", "viewerRole", "members", "invitations"],
        properties: {
          organization: schemaRef("OrganizationWorkspaceDetailOrganization"),
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
      OrganizationAuditAction: {
        type: "string",
        enum: [
          "organization.created",
          "organization.renamed",
          "organization.restored",
          "invitation.created",
          "invitation.reissued",
          "invitation.revoked",
          "invitation.accepted",
          "invitation.expired",
          "invitation.restored",
          "member.role_updated",
          "member.removed",
          "member.restored",
          "posting.created",
          "posting.updated",
          "posting.duplicated",
          "posting.published",
          "posting.paused",
          "posting.unpaused",
          "posting.archived",
          "posting.restored",
          "posting_availability.created",
          "posting_availability.updated",
          "posting_availability.deleted",
          "posting_availability.restored",
          "seasonal_pricing.created",
          "seasonal_pricing.updated",
          "seasonal_pricing.deleted",
          "seasonal_pricing.restored",
          "announcement.created",
          "announcement.updated",
          "announcement.published",
          "announcement.unpublished",
          "announcement.deleted",
          "blog.created",
          "blog.updated",
          "blog.published",
          "blog.unpublished",
          "blog.deleted",
        ],
      },
      OrganizationAuditResourceType: {
        type: "string",
        enum: [
          "organization",
          "invitation",
          "member",
          "posting",
          "posting_availability",
          "seasonal_pricing",
          "announcement",
          "blog",
        ],
      },
      OrganizationAuditActorSummary: {
        type: "object",
        required: ["id", "email", "username"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
        },
      },
      OrganizationAuditChange: {
        type: "object",
        required: ["field", "before", "after"],
        properties: {
          field: { type: "string" },
          before: true,
          after: true,
        },
      },
      OrganizationAuditRecord: {
        type: "object",
        required: [
          "id",
          "organizationId",
          "action",
          "resourceType",
          "organizationVersion",
          "summary",
          "changes",
          "restorable",
          "createdAt",
        ],
        properties: {
          id: { type: "string" },
          organizationId: { type: "string" },
          actor: schemaRef("OrganizationAuditActorSummary"),
          action: schemaRef("OrganizationAuditAction"),
          resourceType: schemaRef("OrganizationAuditResourceType"),
          resourceId: { type: "string" },
          organizationVersion: { type: "integer", minimum: 1 },
          resourceVersion: { type: "integer", minimum: 1 },
          summary: { type: "string" },
          changes: {
            type: "array",
            items: schemaRef("OrganizationAuditChange"),
          },
          beforeSnapshot: true,
          afterSnapshot: true,
          restorable: { type: "boolean" },
          restoredFromAuditId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      OrganizationAuditListResult: {
        type: "object",
        required: ["auditLogs", "pagination"],
        properties: {
          auditLogs: {
            type: "array",
            items: schemaRef("OrganizationAuditRecord"),
          },
          pagination: schemaRef("Pagination"),
        },
      },
      RestoreOrganizationAuditResult: {
        type: "object",
        required: ["restored", "auditLog"],
        properties: {
          restored: { type: "boolean" },
          auditLog: schemaRef("OrganizationAuditRecord"),
        },
      },
      OrganizationAnnouncementStatus: {
        type: "string",
        enum: ["draft", "published"],
      },
      OrganizationAnnouncementAuthorSummary: {
        type: "object",
        required: ["id", "email", "username"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
        },
      },
      OrganizationAnnouncementRecord: {
        type: "object",
        required: [
          "id",
          "organizationId",
          "title",
          "body",
          "status",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          organizationId: { type: "string" },
          author: schemaRef("OrganizationAnnouncementAuthorSummary"),
          title: { type: "string" },
          body: { type: "string" },
          status: schemaRef("OrganizationAnnouncementStatus"),
          publishedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      OrganizationAnnouncementListResult: {
        type: "object",
        required: ["announcements", "pagination"],
        properties: {
          announcements: {
            type: "array",
            items: schemaRef("OrganizationAnnouncementRecord"),
          },
          pagination: schemaRef("Pagination"),
        },
      },
      CreateOrganizationAnnouncementRequest: {
        type: "object",
        required: ["title", "body"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 10000 },
          status: schemaRef("OrganizationAnnouncementStatus"),
        },
      },
      UpdateOrganizationAnnouncementRequest: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 10000 },
          status: schemaRef("OrganizationAnnouncementStatus"),
        },
      },
      DeleteOrganizationAnnouncementResult: {
        type: "object",
        required: ["deleted", "announcementId"],
        properties: {
          deleted: { type: "boolean" },
          announcementId: { type: "string" },
        },
      },
      OrganizationBlogStatus: {
        type: "string",
        enum: ["draft", "published"],
      },
      OrganizationBlogAuthorSummary: {
        type: "object",
        required: ["id", "email", "username"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
        },
      },
      OrganizationBlogOrganizationSummary: {
        type: "object",
        required: ["id", "slug", "name"],
        properties: {
          id: { type: "string" },
          slug: { type: "string", maxLength: 160 },
          name: { type: "string" },
          logoUrl: { type: "string", format: "uri" },
        },
      },
      OrganizationBlogPostRecord: {
        type: "object",
        required: [
          "id",
          "organizationId",
          "title",
          "slug",
          "body",
          "tags",
          "status",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          organizationId: { type: "string" },
          organization: schemaRef("OrganizationBlogOrganizationSummary"),
          author: schemaRef("OrganizationBlogAuthorSummary"),
          title: { type: "string" },
          slug: { type: "string" },
          excerpt: { type: "string" },
          body: { type: "string" },
          coverImageUrl: { type: "string", format: "uri" },
          coverImageBlobName: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          status: schemaRef("OrganizationBlogStatus"),
          commentsEnabled: {
            type: "boolean",
            description:
              "Whether readers may currently post comments on this post. Managers toggle this per post.",
          },
          publishedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          readingMinutes: {
            type: "integer",
            minimum: 1,
            description:
              "Precomputed reading-time estimate in minutes. Present on public list responses (where body is omitted); absent on single-post reads.",
          },
        },
      },
      OrganizationBlogPostListResult: {
        type: "object",
        required: ["posts", "pagination"],
        properties: {
          posts: {
            type: "array",
            items: schemaRef("OrganizationBlogPostRecord"),
          },
          pagination: schemaRef("Pagination"),
          source: {
            type: "string",
            enum: ["elasticsearch", "database"],
            description:
              "Which backend served the result. Present only on public, Elasticsearch-backed reads.",
          },
          query: {
            type: "string",
            description: "Echoes the free-text query, when one was provided.",
          },
        },
      },
      CreateOrganizationBlogPostRequest: {
        type: "object",
        required: ["title", "body"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 100000 },
          excerpt: { type: "string", maxLength: 300, nullable: true },
          slug: { type: "string", maxLength: 220 },
          coverImageUrl: { type: "string", format: "uri", nullable: true },
          coverImageBlobName: { type: "string", nullable: true },
          tags: {
            type: "array",
            items: { type: "string", maxLength: 40 },
            maxItems: 10,
          },
          status: schemaRef("OrganizationBlogStatus"),
          commentsEnabled: { type: "boolean", default: true },
        },
      },
      UpdateOrganizationBlogPostRequest: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          body: { type: "string", minLength: 1, maxLength: 100000 },
          excerpt: { type: "string", maxLength: 300, nullable: true },
          slug: { type: "string", maxLength: 220 },
          coverImageUrl: { type: "string", format: "uri", nullable: true },
          coverImageBlobName: { type: "string", nullable: true },
          tags: {
            type: "array",
            items: { type: "string", maxLength: 40 },
            maxItems: 10,
          },
          status: schemaRef("OrganizationBlogStatus"),
          commentsEnabled: { type: "boolean", default: true },
        },
      },
      OrganizationBlogCommentAuthorSummary: {
        type: "object",
        required: ["id", "username"],
        properties: {
          id: { type: "string" },
          username: {
            type: "string",
            description:
              "Falls back to a generic label when the account has no profile username. An email address is never exposed here, because this record is served on a public page.",
          },
          avatarUrl: { type: "string", format: "uri" },
        },
      },
      OrganizationBlogCommentRecord: {
        type: "object",
        required: [
          "id",
          "blogPostId",
          "organizationId",
          "author",
          "body",
          "createdAt",
          "editedAt",
          "deletedAt",
          "deletedBy",
        ],
        properties: {
          id: { type: "string" },
          blogPostId: { type: "string" },
          organizationId: { type: "string" },
          author: schemaRef("OrganizationBlogCommentAuthorSummary"),
          body: {
            type: "string",
            maxLength: 2000,
            description:
              "Plain text. Empty once the comment has been deleted — the tombstone is the record, not the text.",
          },
          createdAt: { type: "string", format: "date-time" },
          editedAt: { type: "string", format: "date-time", nullable: true },
          deletedAt: { type: "string", format: "date-time", nullable: true },
          deletedBy: {
            type: "string",
            enum: ["author", "moderator"],
            nullable: true,
            description:
              "Who removed the comment, in the only terms a public reader needs. Never a user id: naming the manager who removed a comment would expose staff to the person they moderated.",
          },
        },
      },
      OrganizationBlogCommentListResult: {
        type: "object",
        required: [
          "comments",
          "pagination",
          "commentsEnabled",
          "viewerCanComment",
          "viewerCanModerate",
          "viewerUserId",
        ],
        properties: {
          comments: {
            type: "array",
            items: schemaRef("OrganizationBlogCommentRecord"),
          },
          pagination: schemaRef("Pagination"),
          commentsEnabled: { type: "boolean" },
          viewerCanComment: {
            type: "boolean",
            description:
              "Whether the requesting user may post. False while anonymous and false once comments are closed, which applies to managers too.",
          },
          viewerCanModerate: {
            type: "boolean",
            description:
              "Whether the requesting user manages the owning organization and may therefore remove any comment on this post.",
          },
          viewerUserId: {
            type: "string",
            nullable: true,
            description:
              "The requesting user's id, or null while anonymous. Lets a client resolve which comments are its own without a second call.",
          },
        },
      },
      CreateOrganizationBlogCommentRequest: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 2000 },
        },
      },
      UpdateOrganizationBlogCommentRequest: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 2000 },
        },
      },
      OrganizationBlogCommentSocketTicket: {
        type: "object",
        required: ["expiresInSeconds"],
        properties: {
          expiresInSeconds: {
            type: "integer",
            description:
              "Lifetime of the ticket. The ticket itself is delivered as an HttpOnly cookie scoped to the socket path and never appears in this body.",
          },
        },
      },
      DeleteOrganizationBlogPostResult: {
        type: "object",
        required: ["deleted", "blogPostId"],
        properties: {
          deleted: { type: "boolean" },
          blogPostId: { type: "string" },
        },
      },
      OrganizationReviewerSummary: {
        type: "object",
        properties: {
          username: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
        },
      },
      OrganizationReviewResponse: {
        type: "object",
        required: ["body", "respondedAt"],
        properties: {
          body: { type: "string" },
          respondedAt: { type: "string", format: "date-time" },
          author: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
              username: { type: "string" },
              avatarUrl: { type: "string", format: "uri" },
            },
          },
        },
      },
      OrganizationReviewRecord: {
        type: "object",
        required: [
          "id",
          "organizationId",
          "reviewerId",
          "rating",
          "reviewer",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          organizationId: { type: "string" },
          reviewerId: { type: "string" },
          rating: { type: "integer", minimum: 1, maximum: 5 },
          title: { type: "string" },
          comment: { type: "string" },
          reviewer: schemaRef("OrganizationReviewerSummary"),
          response: {
            ...schemaRef("OrganizationReviewResponse"),
            nullable: true,
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      NullableOrganizationReviewRecord: {
        ...schemaRef("OrganizationReviewRecord"),
        nullable: true,
      },
      OrganizationReviewSummary: {
        type: "object",
        required: ["averageRating", "reviewCount"],
        properties: {
          averageRating: { type: "number" },
          reviewCount: { type: "integer" },
        },
      },
      OrganizationReviewListResult: {
        type: "object",
        required: ["reviews", "summary", "pagination"],
        properties: {
          reviews: {
            type: "array",
            items: schemaRef("OrganizationReviewRecord"),
          },
          summary: schemaRef("OrganizationReviewSummary"),
          pagination: schemaRef("Pagination"),
        },
      },
      CreateOrganizationReviewRequest: {
        type: "object",
        required: ["rating"],
        properties: {
          rating: { type: "integer", minimum: 1, maximum: 5 },
          title: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            nullable: true,
          },
          comment: {
            type: "string",
            minLength: 1,
            maxLength: 2000,
            nullable: true,
          },
        },
      },
      UpdateOrganizationReviewRequest: {
        type: "object",
        required: ["rating"],
        properties: {
          rating: { type: "integer", minimum: 1, maximum: 5 },
          title: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            nullable: true,
          },
          comment: {
            type: "string",
            minLength: 1,
            maxLength: 2000,
            nullable: true,
          },
        },
      },
      ReplyOrganizationReviewRequest: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 2000 },
        },
      },
      DeleteOrganizationReviewResult: {
        type: "object",
        required: ["deleted", "reviewId"],
        properties: {
          deleted: { type: "boolean" },
          reviewId: { type: "string" },
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
          isNewUser: {
            type: "boolean",
            description:
              "Present and true only when a first-time OAuth sign-in just created this account, so the client can surface the generated-username onboarding flow. Absent for returning sign-ins and all local flows.",
          },
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
        required: ["username", "password", "captchaToken"],
        properties: {
          username: {
            type: "string",
            minLength: 3,
            maxLength: 50,
            pattern: "^[A-Za-z0-9._-]+$",
          },
          password: { type: "string" },
          captchaToken: { type: "string" },
          rememberMe: { type: "boolean" },
          deviceId: { type: "string" },
        },
      },
      LocalSignupRequest: {
        type: "object",
        required: ["username", "email", "password", "captchaToken"],
        properties: {
          username: {
            type: "string",
            minLength: 3,
            maxLength: 50,
            pattern: "^[A-Za-z0-9._-]+$",
          },
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
        required: ["username", "captchaToken"],
        properties: {
          username: { type: "string" },
          captchaToken: { type: "string" },
        },
      },
      ForgotUsernameRequest: {
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
        required: ["username", "code", "newPassword"],
        properties: {
          username: { type: "string" },
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
      BlobDeleteResult: {
        type: "object",
        required: ["deleted"],
        properties: {
          deleted: { type: "boolean", const: true },
        },
      },
      MfaVerificationScope: {
        type: "string",
        enum: ["mfa-management", "device-login"],
        description: "Step-up verification scope.",
      },
      MfaVerificationFactor: {
        type: "string",
        enum: ["email", "totp", "sms"],
      },
      MfaVerificationChallengeFactor: {
        type: "string",
        enum: ["email", "totp"],
      },
      MfaVerificationOptionsResult: {
        type: "object",
        required: [
          "scope",
          "verified",
          "verifiedUntil",
          "availableFactors",
          "recommendedFactor",
        ],
        properties: {
          scope: schemaRef("MfaVerificationScope"),
          verified: { type: "boolean" },
          verifiedUntil: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          availableFactors: {
            type: "array",
            items: schemaRef("MfaVerificationFactor"),
          },
          recommendedFactor: {
            type: "string",
            enum: ["email", "totp", "sms"],
            nullable: true,
          },
        },
      },
      MfaVerificationChallengeRequest: {
        type: "object",
        required: ["scope", "factor"],
        properties: {
          scope: schemaRef("MfaVerificationScope"),
          factor: schemaRef("MfaVerificationChallengeFactor"),
        },
      },
      MfaVerificationChallengeResult: {
        oneOf: [
          {
            type: "object",
            required: ["scope", "factor", "challengeId", "cooldownUntil"],
            properties: {
              scope: schemaRef("MfaVerificationScope"),
              factor: { type: "string", const: "email" },
              challengeId: { type: "null" },
              cooldownUntil: { type: "string", format: "date-time" },
            },
          },
          {
            type: "object",
            required: ["scope", "factor", "challengeId", "prompt"],
            properties: {
              scope: schemaRef("MfaVerificationScope"),
              factor: { type: "string", const: "totp" },
              challengeId: { type: "null" },
              prompt: { type: "boolean", const: true },
            },
          },
        ],
      },
      MfaVerificationConfirmRequest: {
        type: "object",
        required: ["scope", "factor", "code"],
        properties: {
          scope: schemaRef("MfaVerificationScope"),
          factor: schemaRef("MfaVerificationChallengeFactor"),
          code: { type: "string", minLength: 1 },
        },
      },
      MfaVerificationConfirmResult: {
        type: "object",
        required: ["verified", "scope", "factor", "verifiedUntil"],
        properties: {
          verified: { type: "boolean", const: true },
          scope: schemaRef("MfaVerificationScope"),
          factor: schemaRef("MfaVerificationChallengeFactor"),
          verifiedUntil: { type: "string", format: "date-time" },
        },
      },
      MfaVerificationPreviewResult: {
        type: "object",
        required: ["scope", "factor", "code", "expiresInSeconds"],
        properties: {
          scope: schemaRef("MfaVerificationScope"),
          factor: { type: "string", const: "email" },
          code: { type: "string" },
          expiresInSeconds: { type: "integer" },
        },
      },
      MfaTotpStatusResult: {
        type: "object",
        required: ["enabled"],
        properties: {
          enabled: { type: "boolean" },
        },
      },
      MfaTotpBeginRequest: {
        type: "object",
        properties: {
          accountName: { type: "string", minLength: 1 },
        },
      },
      MfaTotpBeginResult: {
        type: "object",
        required: ["secret", "uri"],
        properties: {
          secret: { type: "string" },
          uri: { type: "string" },
        },
      },
      MfaTotpConfirmRequest: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string", minLength: 1 },
        },
      },
      MfaTotpConfirmResult: {
        type: "object",
        required: ["confirmed"],
        properties: {
          confirmed: { type: "boolean", const: true },
        },
      },
      MfaTotpDisableRequest: {
        type: "object",
        additionalProperties: false,
      },
      MfaTotpDisableResult: {
        type: "object",
        required: ["disabled"],
        properties: {
          disabled: { type: "boolean", const: true },
        },
      },
      MfaTotpPendingCancelResult: {
        type: "object",
        required: ["cancelled"],
        properties: {
          cancelled: { type: "boolean", const: true },
        },
      },
      FeatureFlagSource: {
        type: "string",
        enum: ["db", "env", "default"],
      },
      ResolvedFeatureFlag: {
        type: "object",
        required: ["name", "enabled", "source", "group"],
        properties: {
          name: { type: "string" },
          enabled: { type: "boolean" },
          source: schemaRef("FeatureFlagSource"),
          description: { type: "string", nullable: true },
          group: { type: "string", nullable: true },
        },
      },
      FeatureFlagListResult: {
        type: "array",
        items: schemaRef("ResolvedFeatureFlag"),
      },
      SetFeatureFlagRequest: {
        type: "object",
        required: ["enabled"],
        properties: {
          enabled: { type: "boolean" },
          description: { type: "string", maxLength: 1000, nullable: true },
          group: {
            type: "string",
            minLength: 1,
            maxLength: 100,
            nullable: true,
          },
        },
      },
      DeleteFeatureFlagResult: {
        type: "object",
        required: [
          "name",
          "deletedOverride",
          "effectiveEnabled",
          "effectiveSource",
        ],
        properties: {
          name: { type: "string" },
          deletedOverride: { type: "boolean" },
          effectiveEnabled: { type: "boolean" },
          effectiveSource: schemaRef("FeatureFlagSource"),
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
      UsernameAvailabilityResult: {
        type: "object",
        required: ["username", "available", "reason"],
        properties: {
          username: {
            type: "string",
            description:
              "The normalized (trimmed, lowercased) username checked.",
          },
          available: { type: "boolean" },
          reason: {
            type: "string",
            nullable: true,
            enum: ["taken", null],
            description:
              "Why the username is unavailable, or null when it is available. A username is `taken` when another account holds it or an unverified signup has reserved it.",
          },
        },
      },
      UpdateProfileRequest: {
        type: "object",
        required: ["username"],
        properties: {
          username: {
            type: "string",
            minLength: 3,
            maxLength: 50,
            pattern: "^[A-Za-z0-9._-]+$",
            description:
              "Trimmed and lowercased before it is stored, so casing is not significant. Changing this value is limited to once every 30 days. Resending the current username is always accepted and does not spend the cooldown.",
          },
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
        enum: ["bug_report", "feature_request", "usability", "praise", "other"],
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
      OwnerPostingsStatusSummary: {
        type: "object",
        required: ["total", "byStatus"],
        properties: {
          total: { type: "integer" },
          byStatus: {
            type: "object",
            required: ["draft", "published", "paused", "archived"],
            properties: {
              draft: { type: "integer" },
              published: { type: "integer" },
              paused: { type: "integer" },
              archived: { type: "integer" },
            },
          },
        },
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
          organizationFilter: {
            type: "object",
            description:
              "Present when an organization filter was requested. Echoes the request and reports which organizations it resolved to.",
            properties: {
              query: { type: "string" },
              organizationId: { type: "string", format: "uuid" },
              matches: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "name", "slug"],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    slug: { type: "string" },
                  },
                },
              },
              truncated: {
                type: "boolean",
                description:
                  "True when more organizations matched the name than were applied to the filter.",
              },
            },
            required: ["matches", "truncated"],
          },
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
      AvailabilityCalendarDay: {
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["available", "blocked", "booked", "unavailable"],
          },
          reason: { type: "string" },
          validStart: { type: "boolean" },
        },
      },
      AvailabilityCalendarResult: {
        type: "object",
        description:
          "Map of `YYYY-MM-DD` (in the requested timezone) to that day's availability.",
        additionalProperties: schemaRef("AvailabilityCalendarDay"),
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
      SeasonalPricingRule: {
        type: "object",
        additionalProperties: true,
      },
      SeasonalPricingRuleList: {
        type: "array",
        items: schemaRef("SeasonalPricingRule"),
      },
      SeasonalPricingRuleRequest: {
        type: "object",
        required: ["name", "startDate", "endDate", "dailyAmount"],
        properties: {
          name: { type: "string" },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          dailyAmount: { type: "number" },
        },
      },
      CreatePostingReviewRequest: {
        type: "object",
        required: ["rating"],
        properties: {
          rating: { type: "integer", minimum: 1, maximum: 5 },
          title: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            nullable: true,
          },
          comment: {
            type: "string",
            minLength: 1,
            maxLength: 2000,
            nullable: true,
          },
        },
      },
      PostingReviewRecord: {
        type: "object",
        additionalProperties: true,
      },
      GetOwnPostingReviewResult: {
        type: "object",
        required: ["eligible", "review"],
        properties: {
          eligible: {
            type: "boolean",
            description:
              "Whether the caller may currently create or update a review for this posting.",
          },
          review: {
            ...schemaRef("PostingReviewRecord"),
            nullable: true,
          },
        },
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
      SavedPostingState: {
        type: "object",
        required: ["postingId", "saved", "savedAt"],
        properties: {
          postingId: { type: "string" },
          saved: {
            type: "boolean",
            description:
              "Whether the posting is saved by the caller after this operation.",
          },
          savedAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            description: "When the posting was saved, or null once removed.",
          },
        },
      },
      SavedPostingRecord: {
        allOf: [
          schemaRef("PublicPostingRecord"),
          {
            type: "object",
            required: ["savedAt"],
            properties: {
              savedAt: { type: "string", format: "date-time" },
            },
          },
        ],
      },
      UnavailableSavedPosting: {
        type: "object",
        required: ["postingId", "name", "reason", "savedAt"],
        properties: {
          postingId: { type: "string" },
          name: {
            type: "string",
            nullable: true,
            description:
              "Name the posting had when it was last readable, or null once the posting record is gone.",
          },
          reason: {
            type: "string",
            enum: ["paused", "unavailable"],
            description:
              "`paused` can be reversed by the owner; `unavailable` covers archived, unpublished, and removed postings.",
          },
          savedAt: { type: "string", format: "date-time" },
        },
      },
      ListSavedPostingsResult: {
        type: "object",
        required: ["postings", "pagination", "unavailablePostings"],
        properties: {
          postings: {
            type: "array",
            items: schemaRef("SavedPostingRecord"),
          },
          pagination: schemaRef("Pagination"),
          unavailablePostings: {
            type: "array",
            items: schemaRef("UnavailableSavedPosting"),
            description:
              "Saved postings on this page that are no longer publicly viewable. They still count towards the pagination total.",
          },
        },
      },
      ListSavedPostingIdsResult: {
        type: "object",
        required: ["postingIds", "truncated"],
        properties: {
          postingIds: {
            type: "array",
            items: { type: "string" },
          },
          truncated: {
            type: "boolean",
            description:
              "Whether the caller has more saved postings than this response carries.",
          },
        },
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
            enum: [
              "posting",
              "posting_review",
              "user",
              "organization_blog_comment",
            ],
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
            enum: [
              "posting",
              "posting_review",
              "user",
              "organization_blog_comment",
            ],
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
          comment: {
            type: "object",
            description:
              "Present when `subjectType` is `organization_blog_comment`.",
            properties: {
              id: { type: "string" },
              bodyExcerpt: { type: "string" },
              author: schemaRef("ContentReportUserSummary"),
              post: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  slug: { type: "string" },
                  organization: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
          },
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
            enum: [
              "posting",
              "posting_review",
              "user",
              "organization_blog_comment",
            ],
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
      SendBookingMessageRequest: {
        type: "object",
        required: ["body"],
        properties: {
          body: {
            type: "string",
            minLength: 1,
            maxLength: 2000,
            description:
              "Message text. Trimmed before validation, so whitespace-only bodies are rejected.",
          },
        },
      },
      BookingMessageRecord: {
        type: "object",
        required: [
          "id",
          "bookingRequestId",
          "authorId",
          "authorSide",
          "authorUsername",
          "body",
          "createdAt",
          "readAt",
          "deliveredAt",
          "editedAt",
          "deletedAt",
        ],
        properties: {
          id: { type: "string" },
          bookingRequestId: { type: "string" },
          authorId: { type: "string" },
          authorSide: {
            type: "string",
            enum: ["renter", "owner"],
            description:
              "Which side of the booking authored the message, derived from the booking's renter.",
          },
          authorUsername: {
            type: "string",
            description:
              "The author's username, so a thread with several organization managers stays legible.",
          },
          body: {
            type: "string",
            maxLength: 2000,
            description: "Empty once the message is deleted.",
          },
          createdAt: { type: "string", format: "date-time" },
          readAt: {
            type: ["string", "null"],
            format: "date-time",
            description:
              "When the recipient side read this message, or null while unread.",
          },
          deliveredAt: {
            type: ["string", "null"],
            format: "date-time",
            description:
              "When the recipient's client acknowledged receipt over the socket. Weaker than readAt: the bytes arrived, which can happen while the thread sits unopened.",
          },
          editedAt: {
            type: ["string", "null"],
            format: "date-time",
            description: "When the author last edited the message.",
          },
          deletedAt: {
            type: ["string", "null"],
            format: "date-time",
            description:
              "When the author deleted the message. The row is kept as a tombstone so the booking retains a record that a message existed.",
          },
        },
      },
      BookingMessagesListResult: {
        type: "object",
        required: [
          "messages",
          "pagination",
          "unreadCount",
          "canWrite",
          "counterpartName",
          "viewerSide",
        ],
        properties: {
          messages: {
            type: "array",
            items: schemaRef("BookingMessageRecord"),
          },
          pagination: schemaRef("Pagination"),
          unreadCount: {
            type: "integer",
            minimum: 0,
            description:
              "Unread messages addressed to the requesting side across the whole thread.",
          },
          canWrite: {
            type: "boolean",
            description:
              "Whether the requesting user may send messages and mark the thread read. Resolved against the booking's organization, so a manager who belongs to several organizations keeps write access on a booking owned by any of them.",
          },
          counterpartName: {
            type: "string",
            description:
              "Who the requesting user is talking to: the owning organization's name for a renter, and the renter's username for the organization side.",
          },
          viewerSide: {
            type: "string",
            enum: ["renter", "owner"],
            description:
              "Which side of the thread the requesting user is on. Align the conversation against this rather than the author's user id, so a second organization manager sees a colleague's message as outgoing.",
          },
        },
      },
      BookingMessageSocketTicket: {
        type: "object",
        required: ["expiresInSeconds"],
        description:
          "The ticket itself is delivered as an HttpOnly cookie scoped to the socket path, never in this body.",
        properties: {
          expiresInSeconds: { type: "integer", minimum: 1 },
        },
      },
      MarkBookingMessagesReadResult: {
        type: "object",
        required: ["bookingRequestId", "markedCount", "readAt"],
        properties: {
          bookingRequestId: { type: "string" },
          markedCount: { type: "integer", minimum: 0 },
          readAt: { type: "string", format: "date-time" },
        },
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
        "- `POST /sms/webhooks/telnyx` uses `telnyx-signature-ed25519` and `telnyx-timestamp` headers instead of bearer authentication.",
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
          "Public organization directory browsing plus protected workspace memberships, invitations, active-org switching, and member management.",
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
        name: "sms",
        description:
          "Outbound SMS delivery infrastructure and provider webhook ingestion.",
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
      {
        name: "mfa",
        description:
          "Multi-factor step-up verification and authenticator (TOTP) enrollment.",
      },
      {
        name: "feature-flags",
        description: "Administrative feature-flag resolution and overrides.",
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
