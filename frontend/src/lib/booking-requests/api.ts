import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type {
  BookingCancellationQuoteResult,
  BookingDashboardSort,
  BookingRequestRecord,
  BookingRequestsListResult,
  BookingRequestStatus,
  OwnerBookingDashboardActionNeeded,
  OwnerBookingDashboardResult,
  RenterBookingDashboardBucket,
  RenterBookingDashboardResult,
} from "@/lib/bookings/types";

export interface CreateBookingRequestInput {
  startAt: string;
  endAt: string;
  guestCount?: number;
  note?: string | null;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string | null;
}

export interface BookingQuoteInput {
  startAt: string;
  endAt: string;
  guestCount?: number;
  note?: string | null;
}

export interface BookingQuoteFailureReason {
  code:
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

export type UpdateBookingRequestInput = CreateBookingRequestInput;

export interface DecideBookingRequestInput {
  note?: string | null;
}

export interface CancelBookingRequestInput {
  reason?: string | null;
}

export const bookingRequestsApi = {
  create(
    postingId: string,
    input: CreateBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord, CreateBookingRequestInput>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/booking-requests`,
      input,
    );
  },
  quote(
    postingId: string,
    input: BookingQuoteInput,
  ): Promise<BookingQuoteResult> {
    return authenticatedJson<BookingQuoteResult, BookingQuoteInput>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/booking-quote`,
      input,
    );
  },
  listForPosting(
    postingId: string,
    input?: {
      page?: number;
      pageSize?: number;
      status?: BookingRequestStatus;
    },
  ): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>(
      "GET",
      buildPathWithQuery(
        `/postings/${encodeURIComponent(postingId)}/booking-requests`,
        {
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 20,
          status: input?.status,
        },
      ),
    );
  },
  listMine(input?: {
    page?: number;
    pageSize?: number;
    status?: BookingRequestStatus;
  }): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>(
      "GET",
      buildPathWithQuery("/booking-requests/me", {
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        status: input?.status,
      }),
    );
  },
  listOwned(input?: {
    page?: number;
    pageSize?: number;
    status?: BookingRequestStatus;
  }): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>(
      "GET",
      buildPathWithQuery("/booking-requests/owner", {
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        status: input?.status,
      }),
    );
  },
  getRenterDashboard(input?: {
    page?: number;
    pageSize?: number;
    sort?: BookingDashboardSort;
    bucket?: RenterBookingDashboardBucket;
    status?: BookingRequestStatus;
  }): Promise<RenterBookingDashboardResult> {
    return authenticatedJson<RenterBookingDashboardResult>(
      "GET",
      buildPathWithQuery("/booking-requests/me/dashboard", {
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        sort: input?.sort,
        bucket: input?.bucket,
        status: input?.status,
      }),
    );
  },
  getOwnerDashboard(input?: {
    page?: number;
    pageSize?: number;
    sort?: BookingDashboardSort;
    status?: BookingRequestStatus;
    actionNeeded?: OwnerBookingDashboardActionNeeded;
    postingId?: string;
  }): Promise<OwnerBookingDashboardResult> {
    return authenticatedJson<OwnerBookingDashboardResult>(
      "GET",
      buildPathWithQuery("/booking-requests/owner/dashboard", {
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        sort: input?.sort,
        status: input?.status,
        actionNeeded: input?.actionNeeded,
        postingId: input?.postingId,
      }),
    );
  },
  getById(bookingRequestId: string): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord>(
      "GET",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}`,
    );
  },
  update(
    bookingRequestId: string,
    input: UpdateBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord, UpdateBookingRequestInput>(
      "PATCH",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}`,
      input,
    );
  },
  getCancellationQuote(
    bookingRequestId: string,
  ): Promise<BookingCancellationQuoteResult> {
    return authenticatedJson<BookingCancellationQuoteResult>(
      "GET",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/cancellation-quote`,
    );
  },
  approve(
    bookingRequestId: string,
    input: DecideBookingRequestInput = {},
  ): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord, DecideBookingRequestInput>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/approve`,
      input,
    );
  },
  decline(
    bookingRequestId: string,
    input: DecideBookingRequestInput = {},
  ): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord, DecideBookingRequestInput>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/decline`,
      input,
    );
  },
  cancel(
    bookingRequestId: string,
    input: CancelBookingRequestInput,
  ): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord, CancelBookingRequestInput>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/cancel`,
      input,
    );
  },
};
