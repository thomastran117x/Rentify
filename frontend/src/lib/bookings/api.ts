import { readJson, toApiError, unwrapApiResponse } from "@/lib/api/response";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import { readStoredSession } from "@/lib/auth/storage";
import type { BookingCancellationQuoteResult, BookingRequestRecord, BookingRequestsListResult } from "@/lib/bookings/types";
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
  method: "GET" | "POST",
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

export const bookingsApi = {
  listMine(): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>("GET", "/booking-requests/me");
  },

  listOwned(): Promise<BookingRequestsListResult> {
    return authenticatedJson<BookingRequestsListResult>("GET", "/booking-requests/owner");
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
};
