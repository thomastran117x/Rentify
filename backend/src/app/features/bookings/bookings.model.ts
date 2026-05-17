import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_BOOKING_DURATION_DAYS,
  MAX_PAGE_SIZE,
  postingPricingSchema,
} from "@/features/postings/postings.model";

export const MAX_BOOKING_NOTE_LENGTH = 1000;
export const MAX_BOOKING_DECISION_NOTE_LENGTH = 1000;
export const MAX_BOOKING_GUEST_COUNT = 20;
export const MAX_BOOKING_CONTACT_NAME_LENGTH = 255;
export const MAX_BOOKING_CONTACT_EMAIL_LENGTH = 255;
export const MAX_BOOKING_CONTACT_PHONE_LENGTH = 32;
export const MAX_ACTIVE_BOOKING_REQUESTS_PER_POSTING = 2;
export const PENDING_BOOKING_HOLD_HOURS = 24;
export const APPROVED_BOOKING_HOLD_HOURS = 72;
export const CONVERSION_RESERVATION_MINUTES = 5;

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

export const createBookingRequestSchema = z.object({
  startAt: z.string().datetime("Booking request start time must be an ISO datetime."),
  endAt: z.string().datetime("Booking request end time must be an ISO datetime."),
  guestCount: z.coerce
    .number()
    .int("Guest count must be an integer.")
    .min(1, "Guest count must be at least 1.")
    .max(MAX_BOOKING_GUEST_COUNT, `Guest count must be at most ${MAX_BOOKING_GUEST_COUNT}.`)
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
    z.string().trim().max(MAX_BOOKING_DECISION_NOTE_LENGTH).nullable().optional(),
  ),
});

export const listBookingRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: bookingRequestStatusSchema.optional(),
});

export type BookingRequestStatus = z.infer<typeof bookingRequestStatusSchema>;
export type CreateBookingRequestBody = z.infer<typeof createBookingRequestSchema>;
export type BookingQuoteBody = z.infer<typeof bookingQuoteSchema>;
export type UpdateBookingRequestBody = z.infer<typeof updateBookingRequestSchema>;
export type DecideBookingRequestBody = z.infer<typeof decideBookingRequestSchema>;
export type ListBookingRequestsQuery = z.infer<typeof listBookingRequestsQuerySchema>;

export interface BookingRequestPostingSummary {
  id: string;
  name: string;
  primaryPhotoUrl?: string;
  effectiveMaxBookingDurationDays: number;
}

export interface BookingRequestRecord {
  id: string;
  postingId: string;
  renterId: string;
  ownerId: string;
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
  refundedAt?: string;
  declinedAt?: string;
  expiredAt?: string;
  convertedAt?: string;
  conversionReservedAt?: string;
  conversionReservationExpiresAt?: string;
  holdExpiresAt: string;
  holdBlockId?: string;
  paymentReconciliationRequired?: boolean;
  rentingId?: string;
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

export interface CreateBookingRequestInput {
  postingId: string;
  renterId: string;
  startAt: string;
  endAt: string;
  guestCount?: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
  note?: string | null;
}

export interface BookingQuoteInput {
  postingId: string;
  renterId: string;
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
  postingId: string;
  bookable: boolean;
  durationDays: number | null;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number | null;
  maxBookingDurationDays: number;
  failureReasons: BookingQuoteFailureReason[];
}

export interface DecideBookingRequestInput {
  bookingRequestId: string;
  ownerId: string;
  note?: string | null;
}

export interface UpdateBookingRequestInput {
  bookingRequestId: string;
  renterId: string;
  startAt: string;
  endAt: string;
  guestCount?: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
  note?: string | null;
}

export interface ListRenterBookingRequestsInput {
  renterId: string;
  page: number;
  pageSize: number;
  status?: BookingRequestStatus;
}

export interface ListOwnerBookingRequestsInput {
  ownerId: string;
  postingId: string;
  page: number;
  pageSize: number;
  status?: BookingRequestStatus;
}

export interface CreateBookingRequestPersistenceInput {
  postingId: string;
  renterId: string;
  ownerId: string;
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
  postingId: string;
  startAt: Date;
  endAt: Date;
  excludeBookingRequestId?: string;
  renterId?: string;
}

export interface BookingRequestExpirationRecord {
  id: string;
  postingId: string;
  ownerId: string;
  status: BookingRequestStatus;
  holdBlockId?: string;
}

export const BOOKING_DEFAULTS = {
  defaultMaxBookingDurationDays: DEFAULT_MAX_BOOKING_DURATION_DAYS,
};
