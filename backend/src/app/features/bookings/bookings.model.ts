import { z } from "zod";
import type { RentingDisputeRecord } from "@/features/rentings/rentings.model";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_BOOKING_DURATION_DAYS,
  MAX_PAGE_SIZE,
  postingPricingSchema,
  type PostingCancellationPolicy,
} from "@/features/postings/postings.model";
import { uuidSchema, type Uuid } from "@/configuration/validation/uuid";

export const MAX_BOOKING_NOTE_LENGTH = 1000;
export const MAX_BOOKING_DECISION_NOTE_LENGTH = 1000;
export const MAX_BOOKING_CANCELLATION_REASON_LENGTH = 1000;
export const MAX_BOOKING_GUEST_COUNT = 20;
export const MAX_BOOKING_CONTACT_NAME_LENGTH = 255;
export const MAX_BOOKING_CONTACT_EMAIL_LENGTH = 255;
export const MAX_BOOKING_CONTACT_PHONE_LENGTH = 32;
export const MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING = 2;
export const PENDING_BOOKING_HOLD_HOURS = 24;
export const APPROVED_BOOKING_HOLD_HOURS = 72;
export const CONVERSION_RESERVATION_MINUTES = 5;
export const BOOKING_CANCELLATION_POLICY_CODE = "platform_default_v1" as const;
export const FULL_REFUND_CUTOFF_HOURS = 48;
export const PARTIAL_REFUND_CUTOFF_HOURS = 24;

const trimmedStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional();

export const bookingRequestStatusSchema = z.enum([
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
]);

export const bookingDashboardSortSchema = z.enum(["urgency", "start_at"]);
export const renterBookingDashboardBucketSchema = z.enum([
  "action_needed",
  "upcoming",
  "active",
  "pending",
  "past",
  "cancelled",
]);
export const ownerBookingDashboardActionNeededSchema = z.enum([
  "approval",
  "payment",
  "expiring_hold",
  "payment_failure",
  "conversion",
]);
export const bookingDashboardUrgencyLevelSchema = z.enum([
  "high",
  "medium",
  "low",
  "none",
]);
export const bookingCancellationActorSchema = z.enum(["renter", "owner"]);
export const bookingCancellationRefundTypeSchema = z.enum([
  "full",
  "partial",
  "none",
  "unsupported",
]);

export const createBookingRequestSchema = z.object({
  startAt: z
    .string()
    .datetime("Booking request start time must be an ISO datetime."),
  endAt: z
    .string()
    .datetime("Booking request end time must be an ISO datetime."),
  guestCount: z.coerce
    .number()
    .int("Guest count must be an integer.")
    .min(1, "Guest count must be at least 1.")
    .max(
      MAX_BOOKING_GUEST_COUNT,
      `Guest count must be at most ${MAX_BOOKING_GUEST_COUNT}.`,
    )
    .optional(),
  note: nullableTrimmedStringSchema.pipe(
    z.string().trim().max(MAX_BOOKING_NOTE_LENGTH).nullable().optional(),
  ),
  contactName: trimmedStringSchema.max(
    MAX_BOOKING_CONTACT_NAME_LENGTH,
    `Contact name must be at most ${MAX_BOOKING_CONTACT_NAME_LENGTH} characters.`,
  ),
  contactEmail: z
    .email("Contact email must be a valid email address.")
    .transform((value) => value.trim().toLowerCase())
    .pipe(
      z
        .string()
        .max(
          MAX_BOOKING_CONTACT_EMAIL_LENGTH,
          `Contact email must be at most ${MAX_BOOKING_CONTACT_EMAIL_LENGTH} characters.`,
        ),
    ),
  contactPhoneNumber: nullableTrimmedStringSchema.pipe(
    z
      .string()
      .trim()
      .max(
        MAX_BOOKING_CONTACT_PHONE_LENGTH,
        `Contact phone number must be at most ${MAX_BOOKING_CONTACT_PHONE_LENGTH} characters.`,
      )
      .nullable()
      .optional(),
  ),
});

export const updateBookingRequestSchema = createBookingRequestSchema;

export const bookingQuoteSchema = createBookingRequestSchema.pick({
  startAt: true,
  endAt: true,
  guestCount: true,
  note: true,
});

export const decideBookingRequestSchema = z.object({
  note: nullableTrimmedStringSchema.pipe(
    z
      .string()
      .trim()
      .max(MAX_BOOKING_DECISION_NOTE_LENGTH)
      .nullable()
      .optional(),
  ),
});

export const cancelBookingRequestSchema = z.object({
  reason: nullableTrimmedStringSchema.pipe(
    z
      .string()
      .trim()
      .max(
        MAX_BOOKING_CANCELLATION_REASON_LENGTH,
        `Cancellation reason must be at most ${MAX_BOOKING_CANCELLATION_REASON_LENGTH} characters.`,
      )
      .nullable()
      .optional(),
  ),
});

export const listBookingRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  status: bookingRequestStatusSchema.optional(),
});

export const renterBookingDashboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  sort: bookingDashboardSortSchema.default("urgency"),
  bucket: renterBookingDashboardBucketSchema.optional(),
  status: bookingRequestStatusSchema.optional(),
});

export const ownerBookingDashboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  sort: bookingDashboardSortSchema.default("urgency"),
  status: bookingRequestStatusSchema.optional(),
  actionNeeded: ownerBookingDashboardActionNeededSchema.optional(),
  postingId: z.string().trim().pipe(uuidSchema).optional(),
});

export type BookingRequestStatus = z.infer<typeof bookingRequestStatusSchema>;
export type BookingDashboardSort = z.infer<typeof bookingDashboardSortSchema>;
export type RenterBookingDashboardBucket = z.infer<
  typeof renterBookingDashboardBucketSchema
>;
export type OwnerBookingDashboardActionNeeded = z.infer<
  typeof ownerBookingDashboardActionNeededSchema
>;
export type BookingDashboardUrgencyLevel = z.infer<
  typeof bookingDashboardUrgencyLevelSchema
>;
export type BookingCancellationActor = z.infer<
  typeof bookingCancellationActorSchema
>;
export type BookingCancellationRefundType = z.infer<
  typeof bookingCancellationRefundTypeSchema
>;
export type CreateBookingRequestBody = z.infer<
  typeof createBookingRequestSchema
>;
export type BookingQuoteBody = z.infer<typeof bookingQuoteSchema>;
export type UpdateBookingRequestBody = z.infer<
  typeof updateBookingRequestSchema
>;
export type DecideBookingRequestBody = z.infer<
  typeof decideBookingRequestSchema
>;
export type CancelBookingRequestBody = z.infer<
  typeof cancelBookingRequestSchema
>;
export type ListBookingRequestsQuery = z.infer<
  typeof listBookingRequestsQuerySchema
>;
export type RenterBookingDashboardQuery = z.infer<
  typeof renterBookingDashboardQuerySchema
>;
export type OwnerBookingDashboardQuery = z.infer<
  typeof ownerBookingDashboardQuerySchema
>;

export interface BookingRequestPostingSummary {
  id: Uuid;
  name: string;
  primaryPhotoUrl?: string;
  effectiveMaxBookingDurationDays: number;
}

export interface BookingRequestRecord {
  id: Uuid;
  postingId: Uuid;
  renterId: Uuid;
  organizationId: Uuid;
  status: BookingRequestStatus;
  startAt: string;
  endAt: string;
  durationDays: number;
  guestCount: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string;
  note?: string;
  pricingCurrency: string;
  pricingSnapshot: z.infer<typeof postingPricingSchema>;
  dailyPriceAmount: number;
  estimatedTotal: number;
  decisionNote?: string;
  approvedAt?: string;
  paymentRequiredAt?: string;
  paymentFailedAt?: string;
  cancelledAt?: string;
  cancelledByUserId?: Uuid;
  cancellationActor?: BookingCancellationActor;
  cancellationReason?: string;
  cancellationPolicyCode?: string;
  cancellationRefundAmount?: number;
  refundedAt?: string;
  declinedAt?: string;
  expiredAt?: string;
  convertedAt?: string;
  conversionReservedAt?: string;
  conversionReservationExpiresAt?: string;
  holdExpiresAt: string;
  holdBlockId?: Uuid;
  paymentReconciliationRequired?: boolean;
  rentingId?: Uuid;
  createdAt: string;
  updatedAt: string;
  posting: BookingRequestPostingSummary;
}

export interface BookingRequestsListResult {
  bookingRequests: BookingRequestRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  status?: BookingRequestStatus;
}

export type BookingDashboardNextActionCode =
  | "review_request"
  | "complete_payment"
  | "retry_payment"
  | "convert_to_renting"
  | "update_instructions"
  | "mark_check_in_ready"
  | "mark_check_in_complete"
  | "mark_return_complete"
  | "open_dispute"
  | "await_owner_response"
  | "monitor_upcoming"
  | "view_renting"
  | "none";

export interface BookingDashboardNextAction {
  code: BookingDashboardNextActionCode;
  label: string;
}

export interface BookingDashboardUrgency {
  level: BookingDashboardUrgencyLevel;
  rank: number;
  isActionable: boolean;
  label: string;
  deadlineAt?: string;
}

export interface BookingDashboardItem {
  id: Uuid;
  kind: "booking_request" | "renting";
  bookingRequestId?: Uuid;
  rentingId?: Uuid;
  postingId: Uuid;
  renterId: Uuid;
  organizationId: Uuid;
  status:
    | BookingRequestStatus
    | "confirmed"
    | "check_in_ready"
    | "active"
    | "return_due"
    | "completed"
    | "disputed"
    | "cancelled";
  sourceStatus:
    | BookingRequestStatus
    | "confirmed"
    | "check_in_ready"
    | "active"
    | "return_due"
    | "completed"
    | "disputed"
    | "cancelled";
  startAt: string;
  endAt: string;
  durationDays: number;
  guestCount: number;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number;
  createdAt: string;
  updatedAt: string;
  posting: BookingRequestPostingSummary;
  holdExpiresAt?: string;
  approvedAt?: string;
  paymentRequiredAt?: string;
  paymentFailedAt?: string;
  convertedAt?: string;
  confirmedAt?: string;
  pickupInstructions?: string;
  returnInstructions?: string;
  checkInReadyAt?: string;
  checkInCompletedAt?: string;
  returnDueAt?: string;
  completedAt?: string;
  disputedAt?: string;
  cancelledAt?: string;
  dispute?: RentingDisputeRecord;
  actionNeededCategory?: OwnerBookingDashboardActionNeeded;
  isExpiringHold: boolean;
  nextAction: BookingDashboardNextAction;
  urgency: BookingDashboardUrgency;
}

export interface BookingDashboardPostingOption {
  id: Uuid;
  name: string;
}

export interface RenterBookingDashboardSummary {
  upcoming: number;
  active: number;
  pending: number;
  actionNeeded: number;
  past: number;
  cancelled: number;
}

export interface OwnerBookingDashboardSummary {
  approval: number;
  payment: number;
  expiringHold: number;
  paymentFailure: number;
  conversion: number;
  upcomingRentings: number;
  activeRentings: number;
  pastRentings: number;
  totalOpen: number;
}

export interface RenterBookingDashboardResult {
  summary: RenterBookingDashboardSummary;
  items: BookingDashboardItem[];
  pagination: BookingRequestsListResult["pagination"];
  filters: {
    page: number;
    pageSize: number;
    sort: BookingDashboardSort;
    bucket?: RenterBookingDashboardBucket;
    status?: BookingRequestStatus;
  };
}

/** OwnerBookingDashboardInput once the service has resolved the organization. */
export interface OwnerBookingDashboardPersistenceInput
  extends OwnerBookingDashboardInput {
  organizationId: Uuid;
}

export interface OwnerBookingDashboardResult {
  summary: OwnerBookingDashboardSummary;
  items: BookingDashboardItem[];
  postings: BookingDashboardPostingOption[];
  pagination: BookingRequestsListResult["pagination"];
  filters: {
    page: number;
    pageSize: number;
    sort: BookingDashboardSort;
    status?: BookingRequestStatus;
    actionNeeded?: OwnerBookingDashboardActionNeeded;
    postingId?: Uuid;
  };
}

export interface CreateBookingRequestInput {
  postingId: Uuid;
  renterId: Uuid;
  startAt: string;
  endAt: string;
  guestCount?: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
  note?: string | null;
}

export interface BookingQuoteInput {
  postingId: Uuid;
  renterId: Uuid;
  startAt: string;
  endAt: string;
  guestCount?: number;
  note?: string | null;
}

export type BookingQuoteFailureCode =
  | "own_posting"
  | "posting_unavailable"
  | "invalid_dates"
  | "max_duration_exceeded"
  | "min_duration_not_met"
  | "start_date_in_past"
  | "advance_notice_not_met"
  | "invalid_guest_count"
  | "guest_count_exceeded"
  | "note_too_long"
  | "renting_overlap"
  | "availability_block_overlap"
  | "active_request_limit_exceeded";

export interface BookingQuoteFailureReason {
  code: BookingQuoteFailureCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface BookingQuoteResult {
  postingId: Uuid;
  bookable: boolean;
  durationDays: number | null;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number | null;
  maxBookingDurationDays: number;
  minBookingDurationDays: number | null;
  advanceNoticeDays: number | null;
  instantBooking: boolean;
  cancellationPolicy: PostingCancellationPolicy | null;
  cancellationPolicyNotes: string | null;
  failureReasons: BookingQuoteFailureReason[];
}

export interface DecideBookingRequestInput {
  bookingRequestId: Uuid;
  actorUserId: Uuid;
  note?: string | null;
}

export interface CancelBookingRequestInput {
  bookingRequestId: Uuid;
  actorUserId: Uuid;
  reason?: string | null;
}

export interface UpdateBookingRequestInput {
  bookingRequestId: Uuid;
  renterId: Uuid;
  startAt: string;
  endAt: string;
  guestCount?: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
  note?: string | null;
}

export interface ListRenterBookingRequestsInput {
  renterId: Uuid;
  page: number;
  pageSize: number;
  status?: BookingRequestStatus;
}

export interface ListOwnedBookingRequestsInput {
  actorUserId: Uuid;
  page: number;
  pageSize: number;
  status?: BookingRequestStatus;
}

/** ListOwnedBookingRequestsInput once the service has resolved the owning organization. */
export interface ListOwnedBookingRequestsPersistenceInput
  extends ListOwnedBookingRequestsInput {
  organizationId: Uuid;
}

export interface ListOwnerBookingRequestsInput {
  actorUserId: Uuid;
  postingId: Uuid;
  page: number;
  pageSize: number;
  status?: BookingRequestStatus;
}

/** ListOwnerBookingRequestsInput once the service has resolved the owning organization. */
export interface ListOwnerBookingRequestsPersistenceInput
  extends ListOwnerBookingRequestsInput {
  organizationId: Uuid;
}

export interface RenterBookingDashboardInput {
  renterId: Uuid;
  page: number;
  pageSize: number;
  sort: BookingDashboardSort;
  bucket?: RenterBookingDashboardBucket;
  status?: BookingRequestStatus;
}

// The owning organization is resolved from the actor's active membership in
// BookingsService, so callers neither know nor supply it.
export interface OwnerBookingDashboardInput {
  actorUserId: Uuid;
  page: number;
  pageSize: number;
  sort: BookingDashboardSort;
  status?: BookingRequestStatus;
  actionNeeded?: OwnerBookingDashboardActionNeeded;
  postingId?: Uuid;
}

export interface CreateBookingRequestPersistenceInput {
  postingId: Uuid;
  renterId: Uuid;
  organizationId: Uuid;
  startAt: Date;
  endAt: Date;
  durationDays: number;
  guestCount: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
  note?: string | null;
  pricingCurrency: string;
  pricingSnapshot: z.infer<typeof postingPricingSchema>;
  dailyPriceAmount: number;
  estimatedTotal: number;
  holdExpiresAt: Date;
}

export interface ActiveBookingOverlapInput {
  postingId: Uuid;
  startAt: Date;
  endAt: Date;
  excludeBookingRequestId?: Uuid;
  renterId?: Uuid;
}

export interface BookingRequestExpirationRecord {
  id: Uuid;
  postingId: Uuid;
  organizationId: Uuid;
  status: BookingRequestStatus;
  holdBlockId?: Uuid;
}

export type BookingCancellationFailureCode =
  | "already_started"
  | "booking_already_converted"
  | "booking_status_ineligible"
  | "payment_processing_in_progress"
  | "payment_missing"
  | "payment_refund_failed";

export interface BookingCancellationFailureReason {
  code: BookingCancellationFailureCode;
  message: string;
}

export interface BookingCancellationQuoteResult {
  bookingRequestId: Uuid;
  cancellable: boolean;
  actor: BookingCancellationActor;
  bookingStatus: BookingRequestStatus;
  reasonRequired: boolean;
  policyCode: string;
  refundType: BookingCancellationRefundType;
  refundAmount: number;
  currency: string;
  failureReasons: BookingCancellationFailureReason[];
}

export const BOOKING_DEFAULTS = {
  defaultMaxBookingDurationDays: DEFAULT_MAX_BOOKING_DURATION_DAYS,
};
