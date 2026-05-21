"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CircleDollarSign, ReceiptText, XCircle } from "lucide-react";
import { bookingsApi } from "@/lib/bookings/api";
import type {
  BookingCancellationQuoteResult,
  BookingRequestRecord,
  BookingRequestsListResult,
} from "@/lib/bookings/types";
import { ApiError, type AuthResponseUser } from "@/lib/auth/types";

function formatDateRange(startAt: string, endAt: string): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`;
}

function formatDateTime(value?: string): string | null {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function humanizeStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function canReviewCancellation(booking: BookingRequestRecord): boolean {
  return !["declined", "expired", "cancelled", "refunded"].includes(booking.status);
}

interface BookingListSectionProps {
  title: string;
  subtitle: string;
  bookings: BookingRequestRecord[];
  emptyMessage: string;
  quoteByBookingId: Record<string, BookingCancellationQuoteResult | undefined>;
  reasonByBookingId: Record<string, string>;
  quotePendingId: string | null;
  cancelPendingId: string | null;
  onReviewCancellation: (bookingId: string) => Promise<void>;
  onReasonChange: (bookingId: string, value: string) => void;
  onCancelBooking: (bookingId: string) => Promise<void>;
}

function BookingListSection({
  title,
  subtitle,
  bookings,
  emptyMessage,
  quoteByBookingId,
  reasonByBookingId,
  quotePendingId,
  cancelPendingId,
  onReviewCancellation,
  onReasonChange,
  onCancelBooking,
}: BookingListSectionProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{subtitle}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        {bookings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-600">
            {emptyMessage}
          </div>
        ) : (
          bookings.map((booking) => {
            const quote = quoteByBookingId[booking.id];
            const cancellationTimestamp = formatDateTime(booking.cancelledAt);
            const refundedTimestamp = formatDateTime(booking.refundedAt);

            return (
              <article
                key={booking.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">
                        {booking.posting.name}
                      </h3>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                        {humanizeStatus(booking.status)}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                      <p>{formatDateRange(booking.startAt, booking.endAt)}</p>
                      <p>{formatMoney(booking.estimatedTotal, booking.pricingCurrency)} estimated</p>
                      <p>{booking.guestCount} guest{booking.guestCount === 1 ? "" : "s"}</p>
                      <p>Requested {formatDateTime(booking.createdAt)}</p>
                    </div>
                  </div>

                  {canReviewCancellation(booking) ? (
                    <button
                      type="button"
                      onClick={() => void onReviewCancellation(booking.id)}
                      disabled={quotePendingId === booking.id || cancelPendingId === booking.id}
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {quotePendingId === booking.id ? "Checking..." : "Review cancellation"}
                    </button>
                  ) : null}
                </div>

                {booking.cancellationActor || booking.cancellationReason || cancellationTimestamp ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">
                      Cancelled {cancellationTimestamp ? `on ${cancellationTimestamp}` : ""}
                    </p>
                    {booking.cancellationActor ? (
                      <p className="mt-1">
                        Cancelled by {booking.cancellationActor === "owner" ? "owner" : "renter"}.
                      </p>
                    ) : null}
                    {booking.cancellationReason ? (
                      <p className="mt-1">Reason: {booking.cancellationReason}</p>
                    ) : null}
                    {booking.cancellationRefundAmount !== undefined ? (
                      <p className="mt-1">
                        Recorded refund expectation:{" "}
                        {formatMoney(
                          booking.cancellationRefundAmount,
                          booking.pricingCurrency,
                        )}
                      </p>
                    ) : null}
                    {refundedTimestamp ? (
                      <p className="mt-1">Refund processed {refundedTimestamp}.</p>
                    ) : null}
                  </div>
                ) : null}

                {quote ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700">
                        <ReceiptText className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-amber-900">
                          Cancellation review
                        </p>
                        {quote.cancellable ? (
                          <div className="mt-2 space-y-2 text-sm text-amber-900">
                            <p>
                              Policy: <span className="font-medium">{quote.policyCode}</span>
                            </p>
                            <p>
                              Refund outcome:{" "}
                              <span className="font-medium">
                                {quote.refundType === "none"
                                  ? "No refund"
                                  : quote.refundType === "partial"
                                    ? "Partial refund"
                                    : quote.refundType === "full"
                                      ? "Full refund"
                                      : "Unsupported"}
                              </span>
                            </p>
                            <p>
                              Refund amount:{" "}
                              <span className="font-medium">
                                {formatMoney(quote.refundAmount, quote.currency)}
                              </span>
                            </p>
                            {quote.reasonRequired ? (
                              <label className="mt-3 grid gap-2 text-sm text-amber-950">
                                <span className="font-medium">Owner cancellation reason</span>
                                <textarea
                                  value={reasonByBookingId[booking.id] ?? ""}
                                  onChange={(event) =>
                                    onReasonChange(booking.id, event.target.value)
                                  }
                                  rows={3}
                                  className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-amber-500"
                                  placeholder="Explain why this booking needs to be cancelled."
                                />
                              </label>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => void onCancelBooking(booking.id)}
                                disabled={cancelPendingId === booking.id}
                                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
                                {cancelPendingId === booking.id
                                  ? "Cancelling..."
                                  : "Confirm cancellation"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2 text-sm text-amber-900">
                            <div className="flex items-start gap-2">
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                              <p>{quote.failureReasons[0]?.message ?? "This booking cannot be cancelled."}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

interface AccountBookingsPanelProps {
  role: AuthResponseUser["role"];
}

export function AccountBookingsPanel({ role }: AccountBookingsPanelProps) {
  const [renterBookings, setRenterBookings] = useState<BookingRequestsListResult | null>(null);
  const [ownerBookings, setOwnerBookings] = useState<BookingRequestsListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [quotePendingId, setQuotePendingId] = useState<string | null>(null);
  const [cancelPendingId, setCancelPendingId] = useState<string | null>(null);
  const [quoteByBookingId, setQuoteByBookingId] = useState<
    Record<string, BookingCancellationQuoteResult | undefined>
  >({});
  const [reasonByBookingId, setReasonByBookingId] = useState<Record<string, string>>({});

  const showOwnerSection = role === "owner" || role === "admin";

  async function refreshBookings() {
    setLoading(true);
    setMessage(null);

    try {
      const [mine, owned] = await Promise.all([
        bookingsApi.listMine(),
        showOwnerSection ? bookingsApi.listOwned() : Promise.resolve(null),
      ]);

      setRenterBookings(mine);
      setOwnerBookings(owned);
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Bookings could not be loaded right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialBookings() {
      setLoading(true);
      setMessage(null);

      try {
        const [mine, owned] = await Promise.all([
          bookingsApi.listMine(),
          showOwnerSection ? bookingsApi.listOwned() : Promise.resolve(null),
        ]);

        if (!active) {
          return;
        }

        setRenterBookings(mine);
        setOwnerBookings(owned);
      } catch (error) {
        if (!active) {
          return;
        }

        setMessage(
          error instanceof ApiError
            ? error.message
            : "Bookings could not be loaded right now.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialBookings();

    return () => {
      active = false;
    };
  }, [showOwnerSection]);

  async function handleReviewCancellation(bookingId: string) {
    setQuotePendingId(bookingId);
    setMessage(null);

    try {
      const quote = await bookingsApi.getCancellationQuote(bookingId);
      setQuoteByBookingId((current) => ({
        ...current,
        [bookingId]: quote,
      }));
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Cancellation details could not be loaded.",
      );
    } finally {
      setQuotePendingId(null);
    }
  }

  async function handleCancelBooking(bookingId: string) {
    setCancelPendingId(bookingId);
    setMessage(null);

    try {
      await bookingsApi.cancel(bookingId, {
        reason: reasonByBookingId[bookingId]?.trim() || null,
      });
      setQuoteByBookingId((current) => ({
        ...current,
        [bookingId]: undefined,
      }));
      setReasonByBookingId((current) => ({
        ...current,
        [bookingId]: "",
      }));
      setMessage("Booking cancellation completed.");
      await refreshBookings();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Booking cancellation could not be completed.",
      );
    } finally {
      setCancelPendingId(null);
    }
  }

  if (loading) {
    return (
      <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Loading booking management...
      </section>
    );
  }

  return (
    <section className="lg:col-span-2 grid gap-6">
      {message ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      <BookingListSection
        title="Renter bookings"
        subtitle="Track requests you made, review cancellation terms, and release holds when plans change."
        bookings={renterBookings?.bookingRequests ?? []}
        emptyMessage="No booking requests have been created from this account yet."
        quoteByBookingId={quoteByBookingId}
        reasonByBookingId={reasonByBookingId}
        quotePendingId={quotePendingId}
        cancelPendingId={cancelPendingId}
        onReviewCancellation={handleReviewCancellation}
        onReasonChange={(bookingId, value) =>
          setReasonByBookingId((current) => ({
            ...current,
            [bookingId]: value,
          }))
        }
        onCancelBooking={handleCancelBooking}
      />

      {showOwnerSection ? (
        <BookingListSection
          title="Owner bookings"
          subtitle="Review incoming booking requests across your listings and capture required reasons for owner-initiated cancellations."
          bookings={ownerBookings?.bookingRequests ?? []}
          emptyMessage="No booking requests are currently tied to listings owned by this account."
          quoteByBookingId={quoteByBookingId}
          reasonByBookingId={reasonByBookingId}
          quotePendingId={quotePendingId}
          cancelPendingId={cancelPendingId}
          onReviewCancellation={handleReviewCancellation}
          onReasonChange={(bookingId, value) =>
            setReasonByBookingId((current) => ({
              ...current,
              [bookingId]: value,
            }))
          }
          onCancelBooking={handleCancelBooking}
        />
      ) : null}
    </section>
  );
}
