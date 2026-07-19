import type { PrismaClient } from "@prisma/client";

export type FixtureRole = "owner" | "user" | "moderator" | "admin";
export type SeedSource = "startup" | "script" | "test";

export interface SeedLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface SeedUserFixture {
  id: string;
  email: string;
  password: string;
  username: string;
  firstName: string;
  lastName: string;
  role: FixtureRole;
  emailVerified: boolean;
  phoneNumber?: string;
  avatarUrl?: string;
  trustworthinessScore?: number;
  organizationMemberships?: Array<{
    ownerEmail: string;
    role: "manager" | "operator";
    preferred?: boolean;
  }>;
}

export interface SeedDeviceFixture {
  id: string;
  userEmail: string;
  deviceId: string;
  type: "desktop" | "mobile" | "tablet";
  platform?: string;
  userAgent?: string;
  lastIpAddress?: string;
}

export interface SeedPersonalAccessTokenFixture {
  id: string;
  userEmail: string;
  name: string;
  publicId: string;
  tokenPrefix: string;
  secretHash: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface SeedOAuthIdentityFixture {
  id: string;
  userEmail: string;
  provider: "google" | "microsoft" | "apple";
  providerUserId: string;
  providerEmail?: string;
  emailVerified?: boolean;
  displayName?: string;
  linkedAt?: string;
}

export interface SeedPostingPhotoFixture {
  id: string;
  blobUrl: string;
  blobName: string;
  thumbnailBlobUrl?: string;
  thumbnailBlobName?: string;
  position: number;
}

export interface SeedAvailabilityBlockFixture {
  id: string;
  startAt: string;
  endAt: string;
  note?: string | null;
  source: "owner" | "booking_hold" | "renting";
}

export interface SeedPostingFixture {
  id: string;
  ownerEmail: string;
  status: "draft" | "published" | "paused";
  family: "place" | "equipment" | "vehicle";
  subtype:
    | "entire_place"
    | "private_room"
    | "workspace"
    | "storage_space"
    | "camera"
    | "tool"
    | "audio"
    | "general_equipment"
    | "bike"
    | "car";
  name: string;
  description: string;
  pricingCurrency: string;
  pricing: Record<string, unknown>;
  tags: string[];
  details: Record<string, string | number | boolean | string[]>;
  availabilityStatus: "available" | "limited" | "unavailable";
  availabilityNotes?: string | null;
  maxBookingDurationDays?: number | null;
  latitude: number;
  longitude: number;
  city: string;
  region: string;
  country: string;
  postalCode?: string | null;
  photos: SeedPostingPhotoFixture[];
  availabilityBlocks: SeedAvailabilityBlockFixture[];
}

export interface SeedPaymentAttemptFixture {
  id: string;
  idempotencyKey: string;
  status:
    | "pending"
    | "processing"
    | "succeeded"
    | "failed_retryable"
    | "failed_final";
  retryCount?: number;
  failureCategory?: "transient" | "permanent" | "unknown";
  failureCode?: string;
  failureMessage?: string;
  providerRequestId?: string;
  squarePaymentId?: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  nextRetryAt?: string;
  createdAt: string;
}

export interface SeedRefundFixture {
  id: string;
  issuedByUserEmail?: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  reason?: string;
  idempotencyKey: string;
  squareRefundId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface SeedPayoutFixture {
  id: string;
  status: "scheduled" | "released" | "failed";
  amount: number;
  dueAt: string;
  releasedAt?: string;
  failedAt?: string;
  squarePayoutId?: string;
  failureMessage?: string;
  createdAt: string;
}

export interface SeedPaymentWebhookEventFixture {
  id: string;
  providerEventId: string;
  eventType: string;
  signatureValid: boolean;
  rawPayload: Record<string, unknown>;
  processedAt?: string;
  createdAt: string;
}

export interface SeedPaymentLedgerEntryFixture {
  id: string;
  type:
    | "charge_created"
    | "charge_succeeded"
    | "refund_issued"
    | "payout_scheduled"
    | "payout_released";
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface SeedPaymentFixture {
  id: string;
  provider: "square";
  status:
    | "awaiting_method"
    | "processing"
    | "succeeded"
    | "failed_retryable"
    | "failed_final"
    | "cancelled"
    | "refunded"
    | "partially_refunded";
  pricingCurrency: string;
  rentalSubtotalAmount: number;
  platformFeeAmount: number;
  totalAmount: number;
  squarePaymentId?: string;
  squareOrderId?: string;
  squareLocationId?: string;
  checkoutUrl?: string;
  lastAttemptedAt?: string;
  succeededAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  attempts: SeedPaymentAttemptFixture[];
  refunds: SeedRefundFixture[];
  payout?: SeedPayoutFixture;
  webhookEvents: SeedPaymentWebhookEventFixture[];
  ledgerEntries: SeedPaymentLedgerEntryFixture[];
}

export interface SeedRentingFixture {
  id: string;
  status:
    | "confirmed"
    | "check_in_ready"
    | "active"
    | "return_due"
    | "completed"
    | "disputed"
    | "cancelled";
  confirmedAt: string;
  createdAt: string;
  pickupInstructions?: string;
  returnInstructions?: string;
  checkInReadyAt?: string;
  checkInCompletedAt?: string;
  returnDueAt?: string;
  completedAt?: string;
  disputedAt?: string;
  cancelledAt?: string;
  dispute?: SeedRentingDisputeFixture;
}

export interface SeedRentingDisputeFixture {
  id: string;
  openedByUserEmail: string;
  reason: string;
  details?: string;
  createdAt: string;
}

export interface SeedBookingFixture {
  id: string;
  postingId: string;
  renterEmail: string;
  status:
    | "pending"
    | "approved"
    | "awaiting_payment"
    | "payment_processing"
    | "paid"
    | "payment_failed"
    | "declined"
    | "expired"
    | "cancelled"
    | "refunded";
  startAt: string;
  endAt: string;
  guestCount: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string;
  note?: string;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number;
  holdExpiresAt: string;
  decisionNote?: string;
  approvedAt?: string;
  paymentRequiredAt?: string;
  paymentFailedAt?: string;
  cancelledAt?: string;
  refundedAt?: string;
  declinedAt?: string;
  expiredAt?: string;
  convertedAt?: string;
  conversionReservedAt?: string;
  conversionReservationExpiresAt?: string;
  createdAt: string;
  paymentReconciliationRequired?: boolean;
  holdBlock?: SeedAvailabilityBlockFixture;
  rentingBlock?: SeedAvailabilityBlockFixture;
  payment?: SeedPaymentFixture;
  renting?: SeedRentingFixture;
}

export interface SeedPostingReviewFixture {
  id: string;
  postingId: string;
  reviewerEmail: string;
  rating: number;
  title?: string;
  comment?: string;
  createdAt: string;
}

export interface SeedOrganizationReviewFixture {
  id: string;
  ownerEmail: string;
  reviewerEmail: string;
  rating: number;
  title?: string;
  comment?: string;
  createdAt: string;
  reply?: {
    body: string;
    authorEmail: string;
    respondedAt: string;
  };
}

export interface SeedPostingViewEventFixture {
  id: string;
  postingId: string;
  viewerHash: string;
  userEmail?: string;
  ipAddressHash?: string;
  userAgentHash?: string;
  deviceType: string;
  occurredAt: string;
}

export interface SeedPostingAnalyticsOutboxFixture {
  id: string;
  postingId: string;
  eventType:
    | "posting_viewed"
    | "search_impression"
    | "search_click"
    | "booking_requested"
    | "booking_approved"
    | "booking_declined"
    | "booking_expired"
    | "booking_cancelled"
    | "payment_failed"
    | "refund_recorded"
    | "renting_confirmed";
  payload: Record<string, unknown>;
  attempts?: number;
  availableAt: string;
  processedAt?: string;
  lastError?: string;
}

export interface SeedState {
  userIdsByEmail: Map<string, string>;
  organizationIdsByOwnerEmail: Map<string, string>;
  postingOrganizationIdsByPostingId: Map<string, string>;
}

export interface SeedModuleContext {
  prisma: PrismaClient;
  refresh: boolean;
  source: SeedSource;
  logger: SeedLogger;
  state: SeedState;
}

export interface SeedModule {
  name: string;
  run(context: SeedModuleContext): Promise<void>;
}

export interface RunSeedOrchestratorOptions {
  logger?: SeedLogger;
  onlyIfEmpty?: boolean;
  prisma?: PrismaClient;
  refresh?: boolean;
  source?: SeedSource;
  modules?: SeedModule[];
}

export interface SeedSummary {
  executed: boolean;
  moduleNames: string[];
  reason?: string;
  refresh: boolean;
  source: SeedSource;
}

export function createFixtureId(namespace: number, index: number): string {
  const namespacePart = namespace.toString().padStart(4, "0").slice(-4);
  const indexPart = index.toString().padStart(12, "0").slice(-12);
  return `00000000-0000-0000-${namespacePart}-${indexPart}`;
}
