import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type {
  BookingMessageRecord,
  BookingMessagesListResult,
  MarkBookingMessagesReadResult,
} from "@/lib/booking-messages/types";

export const bookingMessagesApi = {
  list(
    bookingRequestId: string,
    input?: { page?: number; pageSize?: number },
  ): Promise<BookingMessagesListResult> {
    return authenticatedJson<BookingMessagesListResult>(
      "GET",
      buildPathWithQuery(
        `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages`,
        {
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 20,
        },
      ),
    );
  },
  send(
    bookingRequestId: string,
    input: { body: string },
  ): Promise<BookingMessageRecord> {
    return authenticatedJson<BookingMessageRecord, { body: string }>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages`,
      input,
    );
  },
  edit(
    bookingRequestId: string,
    messageId: string,
    input: { body: string },
  ): Promise<BookingMessageRecord> {
    return authenticatedJson<BookingMessageRecord, { body: string }>(
      "PATCH",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages/${encodeURIComponent(messageId)}`,
      input,
    );
  },
  remove(
    bookingRequestId: string,
    messageId: string,
  ): Promise<BookingMessageRecord> {
    return authenticatedJson<BookingMessageRecord>(
      "DELETE",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages/${encodeURIComponent(messageId)}`,
    );
  },
  markRead(bookingRequestId: string): Promise<MarkBookingMessagesReadResult> {
    return authenticatedJson<MarkBookingMessagesReadResult>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages/read`,
    );
  },
};
