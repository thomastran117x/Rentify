import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";

export type RentingStatus =
  | "confirmed"
  | "check_in_ready"
  | "active"
  | "return_due"
  | "completed"
  | "disputed"
  | "cancelled";

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
  posting: {
    id: string;
    name: string;
    primaryPhotoUrl?: string;
  };
  dispute?: RentingDisputeRecord;
}

export interface ListRentingsResult {
  rentings: RentingRecord[];
  pagination: Pagination;
  status?: RentingStatus;
}

export interface ListRentingsFilters {
  page?: number;
  pageSize?: number;
  status?: RentingStatus;
}

export interface UpdateRentingInstructionsInput {
  pickupInstructions: string;
  returnInstructions: string;
}

export interface CreateRentingDisputeInput {
  reason: string;
  details?: string | null;
}

export const rentingsApi = {
  convertBookingRequest(bookingRequestId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/convert`,
      {},
    );
  },
  listMine(filters: ListRentingsFilters = {}): Promise<ListRentingsResult> {
    return authenticatedJson<ListRentingsResult>(
      "GET",
      buildPathWithQuery("/rentings/me", {
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
        status: filters.status,
      }),
    );
  },
  getById(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord>(
      "GET",
      `/rentings/${encodeURIComponent(rentingId)}`,
    );
  },
  updateInstructions(
    rentingId: string,
    input: UpdateRentingInstructionsInput,
  ): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, UpdateRentingInstructionsInput>(
      "PUT",
      `/rentings/${encodeURIComponent(rentingId)}/instructions`,
      input,
    );
  },
  markCheckInReady(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/check-in-ready`,
      {},
    );
  },
  markCheckInComplete(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/check-in`,
      {},
    );
  },
  markReturnComplete(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/return`,
      {},
    );
  },
  createDispute(
    rentingId: string,
    input: CreateRentingDisputeInput,
  ): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, CreateRentingDisputeInput>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/disputes`,
      input,
    );
  },
};
