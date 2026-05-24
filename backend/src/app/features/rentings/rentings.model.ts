import { z } from "zod";
import type { AppRole } from "@/features/auth/auth.model";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, postingPricingSchema } from "@/features/postings/postings.model";

export const MAX_RENTING_INSTRUCTION_LENGTH = 1000;
export const MAX_RENTING_DISPUTE_REASON_LENGTH = 255;
export const MAX_RENTING_DISPUTE_DETAILS_LENGTH = 2000;
export const RENTING_DISPUTE_WINDOW_DAYS = 7;

const requiredTrimmedStringSchema = z.string().trim().min(1);
const optionalTrimmedStringSchema = z.string().trim().min(1).nullable().optional();

export const rentingStatusSchema = z.enum([
  "confirmed",
  "check_in_ready",
  "active",
  "return_due",
  "completed",
  "disputed",
  "cancelled",
]);

export const listRentingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: rentingStatusSchema.optional(),
});

export const updateRentingInstructionsSchema = z.object({
  pickupInstructions: requiredTrimmedStringSchema.max(
    MAX_RENTING_INSTRUCTION_LENGTH,
    `Pickup instructions must be at most ${MAX_RENTING_INSTRUCTION_LENGTH} characters.`,
  ),
  returnInstructions: requiredTrimmedStringSchema.max(
    MAX_RENTING_INSTRUCTION_LENGTH,
    `Return instructions must be at most ${MAX_RENTING_INSTRUCTION_LENGTH} characters.`,
  ),
});

export const createRentingDisputeSchema = z.object({
  reason: requiredTrimmedStringSchema.max(
    MAX_RENTING_DISPUTE_REASON_LENGTH,
    `Dispute reason must be at most ${MAX_RENTING_DISPUTE_REASON_LENGTH} characters.`,
  ),
  details: optionalTrimmedStringSchema.pipe(
    z
      .string()
      .trim()
      .max(
        MAX_RENTING_DISPUTE_DETAILS_LENGTH,
        `Dispute details must be at most ${MAX_RENTING_DISPUTE_DETAILS_LENGTH} characters.`,
      )
      .nullable()
      .optional(),
  ),
});

export type RentingStatus = z.infer<typeof rentingStatusSchema>;
export type ListRentingsQuery = z.infer<typeof listRentingsQuerySchema>;
export type UpdateRentingInstructionsBody = z.infer<typeof updateRentingInstructionsSchema>;
export type CreateRentingDisputeBody = z.infer<typeof createRentingDisputeSchema>;

export interface RentingPostingSummary {
  id: string;
  name: string;
  primaryPhotoUrl?: string;
}

export interface RentingDisputeRecord {
  id: string;
  rentingId: string;
  openedByUserId: string;
  reason: string;
  details?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RentingRecord {
  id: string;
  postingId: string;
  bookingRequestId: string;
  renterId: string;
  ownerId: string;
  status: RentingStatus;
  startAt: string;
  endAt: string;
  durationDays: number;
  guestCount: number;
  pricingCurrency: string;
  pricingSnapshot: z.infer<typeof postingPricingSchema>;
  dailyPriceAmount: number;
  estimatedTotal: number;
  confirmedAt: string;
  pickupInstructions?: string;
  returnInstructions?: string;
  checkInReadyAt?: string;
  checkInCompletedAt?: string;
  returnDueAt?: string;
  completedAt?: string;
  disputedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  posting: RentingPostingSummary;
  dispute?: RentingDisputeRecord;
}

export interface ListRentingsResult {
  rentings: RentingRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  status?: RentingStatus;
}

export interface ConvertBookingRequestInput {
  bookingRequestId: string;
  ownerId: string;
}

export interface ListMyRentingsInput {
  userId: string;
  page: number;
  pageSize: number;
  status?: RentingStatus;
}

export interface ListOwnerDashboardRentingsInput {
  ownerId: string;
  postingId?: string;
}

export interface RentingActorInput {
  rentingId: string;
  actorUserId: string;
  actorRole: AppRole;
}

export interface UpdateRentingInstructionsInput extends RentingActorInput {
  pickupInstructions: string;
  returnInstructions: string;
}

export interface CreateRentingDisputeInput extends RentingActorInput {
  reason: string;
  details?: string | null;
}
