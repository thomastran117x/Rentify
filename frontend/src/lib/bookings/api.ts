import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import { readStoredSession } from "@/lib/auth/storage";
import type {
  BookingCancellationQuoteResult,
  BookingDashboardSort,
  BookingRequestRecord,
  BookingRequestsListResult,
  BookingRequestStatus,
  OwnerBookingDashboardActionNeeded,
  OwnerBookingDashboardResult,
  RentingRecord,
  RenterBookingDashboardBucket,
  RenterBookingDashboardResult,
} from "@/lib/bookings/types";
import { publicEnv } from "@/lib/env";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function readCsrfToken(): string | undefined {
  const token = readCookie(CSRF_COOKIE_NAME);
  return token ? decodeURIComponent(token) : undefined;
}

async function authenticatedJson<TResponse, TBody extends object | undefined = undefined>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: TBody,
): Promise<TResponse> {
  const deviceId = getDeviceId();
  const devicePlatform = getDevicePlatform();
  const session = readStoredSession();
  const csrfToken = readCsrfToken();
  const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    },
    credentials: "include",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await readJson(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  return unwrapApiResponse<TResponse>(payload);
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  return searchParams.toString();
}

export const bookingsApi = {
  listMine(): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>("GET", "/booking-requests/me");
  },

  listOwned(): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>("GET", "/booking-requests/owner");
  },

  getMyDashboard(input?: {
    page?: number;
    pageSize?: number;
    sort?: BookingDashboardSort;
    bucket?: RenterBookingDashboardBucket;
    status?: BookingRequestStatus;
  }): Promise<RenterBookingDashboardResult> {
    return authenticatedJson<RenterBookingDashboardResult>(
      "GET",
      `/booking-requests/me/dashboard?${buildQuery({
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        sort: input?.sort,
        bucket: input?.bucket,
        status: input?.status,
      })}`,
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
      `/booking-requests/owner/dashboard?${buildQuery({
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        sort: input?.sort,
        status: input?.status,
        actionNeeded: input?.actionNeeded,
        postingId: input?.postingId,
      })}`,
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

  cancel(
    bookingRequestId: string,
    input: {
      reason?: string | null;
    },
  ): Promise<BookingRequestRecord> {
    return authenticatedJson<BookingRequestRecord, { reason?: string | null }>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/cancel`,
      input,
    );
  },

  updateRentingInstructions(
    rentingId: string,
    input: {
      pickupInstructions: string;
      returnInstructions: string;
    },
  ): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, typeof input>(
      "PUT",
      `/rentings/${encodeURIComponent(rentingId)}/instructions`,
      input,
    );
  },

  markRentingCheckInReady(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/check-in-ready`,
      {},
    );
  },

  markRentingCheckInComplete(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/check-in`,
      {},
    );
  },

  completeRentingReturn(rentingId: string): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, Record<string, never>>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/return`,
      {},
    );
  },

  createRentingDispute(
    rentingId: string,
    input: {
      reason: string;
      details?: string | null;
    },
  ): Promise<RentingRecord> {
    return authenticatedJson<RentingRecord, typeof input>(
      "POST",
      `/rentings/${encodeURIComponent(rentingId)}/disputes`,
      input,
    );
  },
};
