"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  ReceiptText,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import {
  canManageOrganizationPostings,
  canReadOrganizationPostings,
  isOwnerRole,
} from "@/lib/auth/roles";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { bookingsApi } from "@/lib/bookings/api";
import type {
  BookingCancellationQuoteResult,
  BookingDashboardItem,
  BookingDashboardSort,
  BookingRequestStatus,
  OwnerBookingDashboardActionNeeded,
  OwnerBookingDashboardResult,
  RenterBookingDashboardBucket,
  RenterBookingDashboardResult,
} from "@/lib/bookings/types";

type DashboardView = "owner" | "renter";
type BannerTone = "error" | "success";

interface DashboardBanner {
  tone: BannerTone;
  text: string;
}

const STATUS_OPTIONS: Array<{ label: string; value?: BookingRequestStatus }> = [
  { label: "All statuses" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Awaiting payment", value: "awaiting_payment" },
  { label: "Payment processing", value: "payment_processing" },
  { label: "Paid", value: "paid" },
  { label: "Payment failed", value: "payment_failed" },
  { label: "Declined", value: "declined" },
  { label: "Expired", value: "expired" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Refunded", value: "refunded" },
];

const SORT_OPTIONS: Array<{ label: string; value: BookingDashboardSort }> = [
  { label: "Urgency", value: "urgency" },
  { label: "Start date", value: "start_at" },
];

const RENTER_BUCKET_OPTIONS: Array<{
  label: string;
  value?: RenterBookingDashboardBucket;
}> = [
  { label: "All buckets" },
  { label: "Action needed", value: "action_needed" },
  { label: "Upcoming", value: "upcoming" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Past", value: "past" },
  { label: "Cancelled / refunded", value: "cancelled" },
];

const OWNER_ACTION_OPTIONS: Array<{
  label: string;
  value?: OwnerBookingDashboardActionNeeded;
}> = [
  { label: "All actions" },
  { label: "Approval", value: "approval" },
  { label: "Payment", value: "payment" },
  { label: "Expiring hold", value: "expiring_hold" },
  { label: "Payment failure", value: "payment_failure" },
  { label: "Convert to renting", value: "conversion" },
];

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

function humanizeActionNeeded(value?: string): string | null {
  if (!value) {
    return null;
  }

  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function canReviewCancellation(item: BookingDashboardItem): boolean {
  return (
    item.kind === "booking_request" &&
    !["declined", "expired", "cancelled", "refunded"].includes(
      item.sourceStatus,
    )
  );
}

function bannerClasses(tone: BannerTone): string {
  return tone === "error"
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function urgencyClasses(
  level: BookingDashboardItem["urgency"]["level"],
): string {
  if (level === "high") {
    return "bg-rose-100 text-rose-700";
  }

  if (level === "medium") {
    return "bg-amber-100 text-amber-800";
  }

  if (level === "low") {
    return "bg-sky-100 text-sky-700";
  }

  return "bg-slate-100 text-slate-600";
}

function statusClasses(status: BookingDashboardItem["status"]): string {
  if (
    ["payment_failed", "declined", "expired", "cancelled", "refunded"].includes(
      status,
    )
  ) {
    return "bg-rose-100 text-rose-700";
  }

  if (status === "disputed") {
    return "bg-rose-100 text-rose-700";
  }

  if (
    ["pending", "approved", "awaiting_payment", "payment_processing"].includes(
      status,
    )
  ) {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "paid" || status === "confirmed" || status === "completed") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (
    status === "check_in_ready" ||
    status === "active" ||
    status === "return_due"
  ) {
    return "bg-sky-100 text-sky-700";
  }

  return "bg-slate-100 text-slate-600";
}

function canOpenDispute(item: BookingDashboardItem): boolean {
  if (item.kind !== "renting" || item.dispute) {
    return false;
  }

  if (item.sourceStatus === "active" || item.sourceStatus === "return_due") {
    return true;
  }

  if (item.sourceStatus !== "completed") {
    return false;
  }

  const anchor = item.completedAt ?? item.endAt;
  return Date.now() - new Date(anchor).getTime() <= 7 * 24 * 60 * 60 * 1000;
}

interface BookingItemCardProps {
  item: BookingDashboardItem;
  view: DashboardView;
  canManageOwnerActions: boolean;
  quoteByBookingId: Record<string, BookingCancellationQuoteResult | undefined>;
  reasonByBookingId: Record<string, string>;
  instructionDraftByRentingId: Record<
    string,
    { pickupInstructions: string; returnInstructions: string } | undefined
  >;
  disputeDraftByRentingId: Record<
    string,
    { reason: string; details: string } | undefined
  >;
  quotePendingId: string | null;
  cancelPendingId: string | null;
  rentingMutationPendingKey: string | null;
  onReviewCancellation: (bookingRequestId: string) => Promise<void>;
  onReasonChange: (bookingRequestId: string, value: string) => void;
  onCancelBooking: (bookingRequestId: string) => Promise<void>;
  onInstructionChange: (
    rentingId: string,
    field: "pickupInstructions" | "returnInstructions",
    value: string,
  ) => void;
  onSaveInstructions: (rentingId: string) => Promise<void>;
  onMarkCheckInReady: (rentingId: string) => Promise<void>;
  onMarkCheckInComplete: (rentingId: string) => Promise<void>;
  onCompleteReturn: (rentingId: string) => Promise<void>;
  onDisputeChange: (
    rentingId: string,
    field: "reason" | "details",
    value: string,
  ) => void;
  onCreateDispute: (rentingId: string) => Promise<void>;
}

function BookingItemCard({
  item,
  view,
  canManageOwnerActions,
  quoteByBookingId,
  reasonByBookingId,
  instructionDraftByRentingId,
  disputeDraftByRentingId,
  quotePendingId,
  cancelPendingId,
  rentingMutationPendingKey,
  onReviewCancellation,
  onReasonChange,
  onCancelBooking,
  onInstructionChange,
  onSaveInstructions,
  onMarkCheckInReady,
  onMarkCheckInComplete,
  onCompleteReturn,
  onDisputeChange,
  onCreateDispute,
}: BookingItemCardProps) {
  const quote = item.bookingRequestId
    ? quoteByBookingId[item.bookingRequestId]
    : undefined;
  const cancellationTimestamp = formatDateTime(
    item.kind === "booking_request" && item.sourceStatus === "cancelled"
      ? item.updatedAt
      : undefined,
  );
  const actionNeededLabel = humanizeActionNeeded(item.actionNeededCategory);
  const holdExpiresAt = formatDateTime(item.holdExpiresAt);
  const confirmedAt = formatDateTime(item.confirmedAt);
  const checkInReadyAt = formatDateTime(item.checkInReadyAt);
  const checkInCompletedAt = formatDateTime(item.checkInCompletedAt);
  const returnDueAt = formatDateTime(item.returnDueAt);
  const completedAt = formatDateTime(item.completedAt);
  const disputedAt = formatDateTime(item.disputedAt);
  const rentingInstructions =
    item.kind === "renting"
      ? (instructionDraftByRentingId[item.rentingId ?? ""] ?? {
          pickupInstructions: item.pickupInstructions ?? "",
          returnInstructions: item.returnInstructions ?? "",
        })
      : undefined;
  const disputeDraft =
    item.kind === "renting"
      ? (disputeDraftByRentingId[item.rentingId ?? ""] ?? {
          reason: "",
          details: "",
        })
      : undefined;
  const canManageCurrentView = view !== "owner" || canManageOwnerActions;
  const canEditInstructions =
    item.kind === "renting" && view === "owner" && canManageOwnerActions;
  const isRentingActionPending = (action: string) =>
    rentingMutationPendingKey === `${action}:${item.rentingId}`;

  return (
    <article className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <div className="grid gap-0 lg:grid-cols-[170px_minmax(0,1fr)]">
        <div className="relative min-h-44 bg-slate-100">
          {item.posting.primaryPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.posting.primaryPhotoUrl}
              alt={item.posting.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,_#e2e8f0,_#f8fafc)]" />
          )}
        </div>

        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">
                  {item.posting.name}
                </h3>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusClasses(item.status)}`}
                >
                  {humanizeStatus(item.status)}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${urgencyClasses(item.urgency.level)}`}
                >
                  {item.urgency.label}
                </span>
                {actionNeededLabel ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {actionNeededLabel}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
                <p>{formatDateRange(item.startAt, item.endAt)}</p>
                <p>
                  {formatMoney(item.estimatedTotal, item.pricingCurrency)} total
                </p>
                <p>
                  {item.durationDays} day{item.durationDays === 1 ? "" : "s"}
                </p>
                <p>
                  {item.guestCount} guest{item.guestCount === 1 ? "" : "s"}
                </p>
                <p>Created {formatDateTime(item.createdAt)}</p>
                {confirmedAt ? <p>Confirmed {confirmedAt}</p> : null}
              </div>
            </div>

            {item.kind === "renting" && item.rentingId ? (
              <div className="flex flex-wrap gap-2">
                {canEditInstructions && (
                  <button
                    type="button"
                    onClick={() => void onSaveInstructions(item.rentingId!)}
                    disabled={isRentingActionPending("save-instructions")}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRentingActionPending("save-instructions")
                      ? "Saving..."
                      : "Save instructions"}
                  </button>
                )}
                {view === "owner" &&
                canManageOwnerActions &&
                item.sourceStatus === "confirmed" ? (
                  <button
                    type="button"
                    onClick={() => void onMarkCheckInReady(item.rentingId!)}
                    disabled={isRentingActionPending("check-in-ready")}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRentingActionPending("check-in-ready")
                      ? "Updating..."
                      : "Mark check-in ready"}
                  </button>
                ) : null}
                {view === "owner" &&
                canManageOwnerActions &&
                ["confirmed", "check_in_ready"].includes(item.sourceStatus) ? (
                  <button
                    type="button"
                    onClick={() => void onMarkCheckInComplete(item.rentingId!)}
                    disabled={isRentingActionPending("check-in-complete")}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRentingActionPending("check-in-complete")
                      ? "Updating..."
                      : "Confirm check-in"}
                  </button>
                ) : null}
                {view === "owner" &&
                canManageOwnerActions &&
                ["active", "return_due"].includes(item.sourceStatus) ? (
                  <button
                    type="button"
                    onClick={() => void onCompleteReturn(item.rentingId!)}
                    disabled={isRentingActionPending("complete-return")}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRentingActionPending("complete-return")
                      ? "Updating..."
                      : "Confirm return"}
                  </button>
                ) : null}
              </div>
            ) : canManageCurrentView &&
              canReviewCancellation(item) &&
              item.bookingRequestId ? (
              <button
                type="button"
                onClick={() =>
                  void onReviewCancellation(item.bookingRequestId!)
                }
                disabled={
                  quotePendingId === item.bookingRequestId ||
                  cancelPendingId === item.bookingRequestId
                }
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {quotePendingId === item.bookingRequestId
                  ? "Checking..."
                  : "Review cancellation"}
              </button>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Next action
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {item.nextAction.label}
              </p>
              {holdExpiresAt ? (
                <p className="mt-2 text-sm text-slate-600">
                  Hold expires {holdExpiresAt}
                  {item.isExpiringHold ? " and needs attention soon." : "."}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  {item.kind === "renting"
                    ? "Renting lifecycle actions stay attached to the same card so pickup, return, and dispute follow-up remain easy to track."
                    : "This summary keeps the booking state, urgency, and likely next step together in one card."}
                </p>
              )}
            </div>

            <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Snapshot
              </p>
              <div className="mt-3 grid gap-2 text-sm text-slate-600">
                <p>
                  Status:{" "}
                  <span className="font-medium text-slate-900">
                    {humanizeStatus(item.sourceStatus)}
                  </span>
                </p>
                <p>
                  Urgency:{" "}
                  <span className="font-medium text-slate-900">
                    {item.urgency.label}
                  </span>
                </p>
                <p>
                  Kind:{" "}
                  <span className="font-medium text-slate-900">
                    {item.kind === "renting" ? "Renting" : "Booking request"}
                  </span>
                </p>
                {checkInReadyAt ? (
                  <p>
                    Check-in ready:{" "}
                    <span className="font-medium text-slate-900">
                      {checkInReadyAt}
                    </span>
                  </p>
                ) : null}
                {checkInCompletedAt ? (
                  <p>
                    Check-in completed:{" "}
                    <span className="font-medium text-slate-900">
                      {checkInCompletedAt}
                    </span>
                  </p>
                ) : null}
                {returnDueAt ? (
                  <p>
                    Return due:{" "}
                    <span className="font-medium text-slate-900">
                      {returnDueAt}
                    </span>
                  </p>
                ) : null}
                {completedAt ? (
                  <p>
                    Completed:{" "}
                    <span className="font-medium text-slate-900">
                      {completedAt}
                    </span>
                  </p>
                ) : null}
                {disputedAt ? (
                  <p>
                    Disputed:{" "}
                    <span className="font-medium text-slate-900">
                      {disputedAt}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {item.kind === "renting" && item.rentingId ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700">
                    <ClipboardList className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950">
                      Rental instructions
                    </p>
                    {canEditInstructions && rentingInstructions ? (
                      <div className="mt-3 grid gap-3">
                        <label className="grid gap-2 text-sm text-slate-700">
                          <span className="font-medium">Pickup / check-in</span>
                          <textarea
                            value={rentingInstructions.pickupInstructions}
                            onChange={(event) =>
                              onInstructionChange(
                                item.rentingId!,
                                "pickupInstructions",
                                event.target.value,
                              )
                            }
                            rows={3}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-950"
                            placeholder="Share where and how pickup or check-in works."
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-slate-700">
                          <span className="font-medium">
                            Return / check-out
                          </span>
                          <textarea
                            value={rentingInstructions.returnInstructions}
                            onChange={(event) =>
                              onInstructionChange(
                                item.rentingId!,
                                "returnInstructions",
                                event.target.value,
                              )
                            }
                            rows={3}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-950"
                            placeholder="Share where and how return or check-out works."
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            Pickup / check-in
                          </p>
                          <p className="mt-1 leading-6">
                            {item.pickupInstructions ??
                              "Instructions will appear here once the owner adds them."}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">
                            Return / check-out
                          </p>
                          <p className="mt-1 leading-6">
                            {item.returnInstructions ??
                              "Return instructions will appear here once the owner adds them."}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-700">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-950">
                      Lifecycle timeline
                    </p>
                    <div className="mt-3 grid gap-2 text-sm text-slate-700">
                      <p>
                        Confirmed:{" "}
                        <span className="font-medium text-slate-900">
                          {confirmedAt ?? "Not recorded"}
                        </span>
                      </p>
                      {checkInReadyAt ? (
                        <p>
                          Check-in ready:{" "}
                          <span className="font-medium text-slate-900">
                            {checkInReadyAt}
                          </span>
                        </p>
                      ) : null}
                      {checkInCompletedAt ? (
                        <p>
                          Check-in completed:{" "}
                          <span className="font-medium text-slate-900">
                            {checkInCompletedAt}
                          </span>
                        </p>
                      ) : null}
                      {returnDueAt ? (
                        <p>
                          Return due:{" "}
                          <span className="font-medium text-slate-900">
                            {returnDueAt}
                          </span>
                        </p>
                      ) : null}
                      {completedAt ? (
                        <p>
                          Completed:{" "}
                          <span className="font-medium text-slate-900">
                            {completedAt}
                          </span>
                        </p>
                      ) : null}
                      {item.dispute ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
                          <p className="font-medium text-rose-900">
                            Dispute open
                          </p>
                          <p className="mt-1 text-rose-900">
                            {item.dispute.reason}
                          </p>
                          {item.dispute.details ? (
                            <p className="mt-1 text-rose-800">
                              {item.dispute.details}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {item.kind === "renting" &&
          item.rentingId &&
          canManageCurrentView &&
          canOpenDispute(item) ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-rose-700">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-rose-950">
                    Open a dispute
                  </p>
                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-2 text-sm text-rose-950">
                      <span className="font-medium">Reason</span>
                      <input
                        value={disputeDraft?.reason ?? ""}
                        onChange={(event) =>
                          onDisputeChange(
                            item.rentingId!,
                            "reason",
                            event.target.value,
                          )
                        }
                        className="h-11 rounded-xl border border-rose-200 bg-white px-3 text-slate-900 outline-none transition focus:border-rose-500"
                        placeholder="Summarize the issue."
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-rose-950">
                      <span className="font-medium">Details</span>
                      <textarea
                        value={disputeDraft?.details ?? ""}
                        onChange={(event) =>
                          onDisputeChange(
                            item.rentingId!,
                            "details",
                            event.target.value,
                          )
                        }
                        rows={3}
                        className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-rose-500"
                        placeholder="Add the context support or the other party should see."
                      />
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void onCreateDispute(item.rentingId!)}
                        disabled={isRentingActionPending("open-dispute")}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        {isRentingActionPending("open-dispute")
                          ? "Opening..."
                          : "Open dispute"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {item.kind === "booking_request" &&
          ["cancelled", "refunded"].includes(item.sourceStatus) ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                {item.sourceStatus === "refunded"
                  ? "Refunded booking"
                  : "Cancelled booking"}
                {cancellationTimestamp
                  ? ` updated ${cancellationTimestamp}`
                  : ""}
              </p>
            </div>
          ) : null}

          {quote && item.bookingRequestId && canManageCurrentView ? (
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
                          <span className="font-medium">
                            Owner cancellation reason
                          </span>
                          <textarea
                            value={
                              reasonByBookingId[item.bookingRequestId] ?? ""
                            }
                            onChange={(event) =>
                              onReasonChange(
                                item.bookingRequestId!,
                                event.target.value,
                              )
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
                          onClick={() =>
                            void onCancelBooking(item.bookingRequestId!)
                          }
                          disabled={cancelPendingId === item.bookingRequestId}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <CircleDollarSign
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          {cancelPendingId === item.bookingRequestId
                            ? "Cancelling..."
                            : "Confirm cancellation"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2 text-sm text-amber-900">
                      <div className="flex items-start gap-2">
                        <XCircle
                          className="mt-0.5 h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <p>
                          {quote.failureReasons[0]?.message ??
                            "This booking cannot be cancelled."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function BookingsDashboard() {
  const router = useRouter();
  const { status, session } = useAuth();
  const [activeView, setActiveView] = useState<DashboardView>("renter");
  const [renterDashboard, setRenterDashboard] =
    useState<RenterBookingDashboardResult | null>(null);
  const [ownerDashboard, setOwnerDashboard] =
    useState<OwnerBookingDashboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<DashboardBanner | null>(null);
  const [renterFilters, setRenterFilters] = useState<{
    page: number;
    pageSize: number;
    sort: BookingDashboardSort;
    bucket?: RenterBookingDashboardBucket;
    status?: BookingRequestStatus;
  }>({
    page: 1,
    pageSize: 20,
    sort: "urgency",
  });
  const [ownerFilters, setOwnerFilters] = useState<{
    page: number;
    pageSize: number;
    sort: BookingDashboardSort;
    status?: BookingRequestStatus;
    actionNeeded?: OwnerBookingDashboardActionNeeded;
    postingId?: string;
  }>({
    page: 1,
    pageSize: 20,
    sort: "urgency",
  });
  const [quotePendingId, setQuotePendingId] = useState<string | null>(null);
  const [cancelPendingId, setCancelPendingId] = useState<string | null>(null);
  const [quoteByBookingId, setQuoteByBookingId] = useState<
    Record<string, BookingCancellationQuoteResult | undefined>
  >({});
  const [reasonByBookingId, setReasonByBookingId] = useState<
    Record<string, string>
  >({});
  const [instructionDraftByRentingId, setInstructionDraftByRentingId] =
    useState<
      Record<
        string,
        { pickupInstructions: string; returnInstructions: string } | undefined
      >
    >({});
  const [disputeDraftByRentingId, setDisputeDraftByRentingId] = useState<
    Record<string, { reason: string; details: string } | undefined>
  >({});
  const [rentingMutationPendingKey, setRentingMutationPendingKey] = useState<
    string | null
  >(null);

  const showOwnerView =
    isOwnerRole(session?.user.role) ||
    canReadOrganizationPostings(session?.user.activeOrganization);
  const canManageOwnerView =
    isOwnerRole(session?.user.role) ||
    canManageOrganizationPostings(session?.user.activeOrganization);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (!session) {
      return;
    }

    setActiveView(showOwnerView ? "owner" : "renter");
  }, [session, showOwnerView]);

  useEffect(() => {
    if (status !== "authenticated" || !session) {
      return;
    }

    let active = true;

    async function loadDashboard() {
      setLoading(true);

      try {
        if (activeView === "owner" && showOwnerView) {
          const result = await bookingsApi.getOwnerDashboard(ownerFilters);

          if (!active) {
            return;
          }

          startTransition(() => {
            setOwnerDashboard(result);
          });
        } else {
          const result = await bookingsApi.getMyDashboard(renterFilters);

          if (!active) {
            return;
          }

          startTransition(() => {
            setRenterDashboard(result);
          });
        }

        if (active) {
          setBanner((current) =>
            current?.tone === "success" ? current : null,
          );
        }
      } catch (error) {
        if (active) {
          setBanner({
            tone: "error",
            text: getApiErrorMessage(error, {
              action: "load your bookings",
              fallback:
                "We couldn't load your bookings right now. Please try again.",
            }),
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [activeView, ownerFilters, renterFilters, session, showOwnerView, status]);

  async function refreshActiveDashboard() {
    if (!session) {
      return;
    }

    if (activeView === "owner" && showOwnerView) {
      const result = await bookingsApi.getOwnerDashboard(ownerFilters);
      startTransition(() => {
        setOwnerDashboard(result);
      });
      return;
    }

    const result = await bookingsApi.getMyDashboard(renterFilters);
    startTransition(() => {
      setRenterDashboard(result);
    });
  }

  async function handleReviewCancellation(bookingRequestId: string) {
    setQuotePendingId(bookingRequestId);
    setBanner(null);

    try {
      const quote = await bookingsApi.getCancellationQuote(bookingRequestId);
      setQuoteByBookingId((current) => ({
        ...current,
        [bookingRequestId]: quote,
      }));
    } catch (error) {
      setBanner({
        tone: "error",
        text: getApiErrorMessage(error, {
          action: "load cancellation details",
          fallback:
            "We couldn't load cancellation details right now. Please try again.",
        }),
      });
    } finally {
      setQuotePendingId(null);
    }
  }

  async function handleCancelBooking(bookingRequestId: string) {
    setCancelPendingId(bookingRequestId);
    setBanner(null);

    try {
      await bookingsApi.cancel(bookingRequestId, {
        reason: reasonByBookingId[bookingRequestId]?.trim() || null,
      });
      setQuoteByBookingId((current) => ({
        ...current,
        [bookingRequestId]: undefined,
      }));
      setReasonByBookingId((current) => ({
        ...current,
        [bookingRequestId]: "",
      }));
      await refreshActiveDashboard();
      setBanner({
        tone: "success",
        text: "Booking cancellation completed.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        text: getApiErrorMessage(error, {
          action: "cancel that booking",
          fallback:
            "We couldn't cancel that booking right now. Please try again.",
        }),
      });
    } finally {
      setCancelPendingId(null);
    }
  }

  async function runRentingMutation(
    pendingKey: string,
    request: () => Promise<void>,
    action: string,
    successText: string,
    fallbackErrorText: string,
  ) {
    setRentingMutationPendingKey(pendingKey);
    setBanner(null);

    try {
      await request();
      await refreshActiveDashboard();
      setBanner({
        tone: "success",
        text: successText,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        text: getApiErrorMessage(error, {
          action,
          fallback: fallbackErrorText,
        }),
      });
    } finally {
      setRentingMutationPendingKey(null);
    }
  }

  async function handleSaveInstructions(rentingId: string) {
    const draft = instructionDraftByRentingId[rentingId];

    await runRentingMutation(
      `save-instructions:${rentingId}`,
      async () => {
        await bookingsApi.updateRentingInstructions(rentingId, {
          pickupInstructions: draft?.pickupInstructions?.trim() ?? "",
          returnInstructions: draft?.returnInstructions?.trim() ?? "",
        });
      },
      "save renting instructions",
      "Renting instructions updated.",
      "Renting instructions could not be updated.",
    );
  }

  async function handleMarkCheckInReady(rentingId: string) {
    await runRentingMutation(
      `check-in-ready:${rentingId}`,
      async () => {
        await bookingsApi.markRentingCheckInReady(rentingId);
      },
      "mark this renting as check-in ready",
      "Renting marked as check-in ready.",
      "Renting could not be marked as check-in ready.",
    );
  }

  async function handleMarkCheckInComplete(rentingId: string) {
    await runRentingMutation(
      `check-in-complete:${rentingId}`,
      async () => {
        await bookingsApi.markRentingCheckInComplete(rentingId);
      },
      "confirm check-in for this renting",
      "Renting check-in confirmed.",
      "Renting check-in could not be confirmed.",
    );
  }

  async function handleCompleteReturn(rentingId: string) {
    await runRentingMutation(
      `complete-return:${rentingId}`,
      async () => {
        await bookingsApi.completeRentingReturn(rentingId);
      },
      "confirm the return for this renting",
      "Renting return confirmed.",
      "Renting return could not be confirmed.",
    );
  }

  async function handleCreateDispute(rentingId: string) {
    const draft = disputeDraftByRentingId[rentingId];

    await runRentingMutation(
      `open-dispute:${rentingId}`,
      async () => {
        await bookingsApi.createRentingDispute(rentingId, {
          reason: draft?.reason?.trim() ?? "",
          details: draft?.details?.trim() || null,
        });
        setDisputeDraftByRentingId((current) => ({
          ...current,
          [rentingId]: { reason: "", details: "" },
        }));
      },
      "open a dispute for this renting",
      "Renting dispute opened.",
      "Renting dispute could not be opened.",
    );
  }

  if (status === "loading" || loading) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-slate-200 bg-white px-6 py-10 text-sm text-slate-600">
          Loading bookings workspace...
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 px-6 py-12 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-3xl font-semibold text-slate-950">Bookings</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sign in to track booking requests, payment work, and upcoming
            rentings.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const activeDashboard =
    activeView === "owner" && showOwnerView ? ownerDashboard : renterDashboard;
  const items = activeDashboard?.items ?? [];
  const pagination = activeDashboard?.pagination;

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-[2.2rem] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.08)]">
          <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_34%),linear-gradient(135deg,_#ffffff,_#eff6ff)] px-6 py-7 sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
                  Booking workspace
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950">
                  Keep every booking decision, payment, and upcoming rental in
                  view
                </h1>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  This workspace brings renter timelines and owner action queues
                  together, highlights expiring holds, and keeps the next step
                  obvious for each booking.
                </p>
              </div>

              {showOwnerView ? (
                <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setActiveView("owner")}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      activeView === "owner"
                        ? "bg-slate-950 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Owner
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView("renter")}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      activeView === "renter"
                        ? "bg-slate-950 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Renter
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {banner ? (
          <div
            className={`mt-6 rounded-2xl border px-5 py-4 text-sm ${bannerClasses(banner.tone)}`}
          >
            {banner.text}
          </div>
        ) : null}

        {activeView === "owner" && showOwnerView ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <SummaryCard
                label="Approval"
                value={ownerDashboard?.summary.approval ?? 0}
              />
              <SummaryCard
                label="Payment"
                value={ownerDashboard?.summary.payment ?? 0}
              />
              <SummaryCard
                label="Expiring holds"
                value={ownerDashboard?.summary.expiringHold ?? 0}
              />
              <SummaryCard
                label="Payment failures"
                value={ownerDashboard?.summary.paymentFailure ?? 0}
              />
              <SummaryCard
                label="Convert to renting"
                value={ownerDashboard?.summary.conversion ?? 0}
              />
              <SummaryCard
                label="Total open"
                value={ownerDashboard?.summary.totalOpen ?? 0}
              />
            </section>

            <section className="mt-4 grid gap-4 md:grid-cols-3">
              <SummaryCard
                label="Upcoming rentals"
                value={ownerDashboard?.summary.upcomingRentings ?? 0}
              />
              <SummaryCard
                label="Active rentals"
                value={ownerDashboard?.summary.activeRentings ?? 0}
              />
              <SummaryCard
                label="Past rentals"
                value={ownerDashboard?.summary.pastRentings ?? 0}
              />
            </section>

            <section className="mt-6 rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
              <div className="grid gap-4 lg:grid-cols-4">
                <FilterField label="Action needed">
                  <select
                    value={ownerFilters.actionNeeded ?? ""}
                    onChange={(event) =>
                      setOwnerFilters((current) => ({
                        ...current,
                        page: 1,
                        actionNeeded: (event.target.value || undefined) as
                          | OwnerBookingDashboardActionNeeded
                          | undefined,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    {OWNER_ACTION_OPTIONS.map((option) => (
                      <option
                        key={option.value ?? "all"}
                        value={option.value ?? ""}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Status">
                  <select
                    value={ownerFilters.status ?? ""}
                    onChange={(event) =>
                      setOwnerFilters((current) => ({
                        ...current,
                        page: 1,
                        status: (event.target.value || undefined) as
                          | BookingRequestStatus
                          | undefined,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option
                        key={option.value ?? "all"}
                        value={option.value ?? ""}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Posting">
                  <select
                    value={ownerFilters.postingId ?? ""}
                    onChange={(event) =>
                      setOwnerFilters((current) => ({
                        ...current,
                        page: 1,
                        postingId: event.target.value || undefined,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    <option value="">All postings</option>
                    {(ownerDashboard?.postings ?? []).map((posting) => (
                      <option key={posting.id} value={posting.id}>
                        {posting.name}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Sort">
                  <select
                    value={ownerFilters.sort}
                    onChange={(event) =>
                      setOwnerFilters((current) => ({
                        ...current,
                        page: 1,
                        sort: event.target.value as BookingDashboardSort,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <SummaryCard
                label="Upcoming"
                value={renterDashboard?.summary.upcoming ?? 0}
              />
              <SummaryCard
                label="Active"
                value={renterDashboard?.summary.active ?? 0}
              />
              <SummaryCard
                label="Pending"
                value={renterDashboard?.summary.pending ?? 0}
              />
              <SummaryCard
                label="Action needed"
                value={renterDashboard?.summary.actionNeeded ?? 0}
              />
              <SummaryCard
                label="Past"
                value={renterDashboard?.summary.past ?? 0}
              />
              <SummaryCard
                label="Cancelled / refunded"
                value={renterDashboard?.summary.cancelled ?? 0}
              />
            </section>

            <section className="mt-6 rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
              <div className="grid gap-4 lg:grid-cols-3">
                <FilterField label="Bucket">
                  <select
                    value={renterFilters.bucket ?? ""}
                    onChange={(event) =>
                      setRenterFilters((current) => ({
                        ...current,
                        page: 1,
                        bucket: (event.target.value || undefined) as
                          | RenterBookingDashboardBucket
                          | undefined,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    {RENTER_BUCKET_OPTIONS.map((option) => (
                      <option
                        key={option.value ?? "all"}
                        value={option.value ?? ""}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Status">
                  <select
                    value={renterFilters.status ?? ""}
                    onChange={(event) =>
                      setRenterFilters((current) => ({
                        ...current,
                        page: 1,
                        status: (event.target.value || undefined) as
                          | BookingRequestStatus
                          | undefined,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option
                        key={option.value ?? "all"}
                        value={option.value ?? ""}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Sort">
                  <select
                    value={renterFilters.sort}
                    onChange={(event) =>
                      setRenterFilters((current) => ({
                        ...current,
                        page: 1,
                        sort: event.target.value as BookingDashboardSort,
                      }))
                    }
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-slate-950"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </div>
            </section>
          </>
        )}

        <section className="mt-6 grid gap-5">
          {items.length === 0 ? (
            <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-white px-6 py-10 text-sm text-slate-600">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                  <CalendarDays className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-semibold text-slate-950">
                    No bookings match these filters
                  </p>
                  <p className="mt-2 max-w-2xl leading-6">
                    Try clearing a filter or switching views. This workspace
                    keeps booking work, upcoming handoffs, active rentals, and
                    completed outcomes grouped in one place as activity lands.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            items.map((item) => (
              <BookingItemCard
                key={`${item.kind}-${item.id}`}
                item={item}
                view={activeView}
                canManageOwnerActions={canManageOwnerView}
                quoteByBookingId={quoteByBookingId}
                reasonByBookingId={reasonByBookingId}
                instructionDraftByRentingId={instructionDraftByRentingId}
                disputeDraftByRentingId={disputeDraftByRentingId}
                quotePendingId={quotePendingId}
                cancelPendingId={cancelPendingId}
                rentingMutationPendingKey={rentingMutationPendingKey}
                onReviewCancellation={handleReviewCancellation}
                onReasonChange={(bookingRequestId, value) =>
                  setReasonByBookingId((current) => ({
                    ...current,
                    [bookingRequestId]: value,
                  }))
                }
                onCancelBooking={handleCancelBooking}
                onInstructionChange={(rentingId, field, value) =>
                  setInstructionDraftByRentingId((current) => ({
                    ...current,
                    [rentingId]: {
                      pickupInstructions:
                        field === "pickupInstructions"
                          ? value
                          : (current[rentingId]?.pickupInstructions ?? ""),
                      returnInstructions:
                        field === "returnInstructions"
                          ? value
                          : (current[rentingId]?.returnInstructions ?? ""),
                    },
                  }))
                }
                onSaveInstructions={handleSaveInstructions}
                onMarkCheckInReady={handleMarkCheckInReady}
                onMarkCheckInComplete={handleMarkCheckInComplete}
                onCompleteReturn={handleCompleteReturn}
                onDisputeChange={(rentingId, field, value) =>
                  setDisputeDraftByRentingId((current) => ({
                    ...current,
                    [rentingId]: {
                      reason:
                        field === "reason"
                          ? value
                          : (current[rentingId]?.reason ?? ""),
                      details:
                        field === "details"
                          ? value
                          : (current[rentingId]?.details ?? ""),
                    },
                  }))
                }
                onCreateDispute={handleCreateDispute}
              />
            ))
          )}
        </section>

        {pagination ? (
          <section className="mt-6 flex items-center justify-between gap-3 rounded-[1.8rem] border border-slate-200 bg-white px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
            <p className="text-sm text-slate-500">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (activeView === "owner" && showOwnerView) {
                    setOwnerFilters((current) => ({
                      ...current,
                      page: Math.max(1, current.page - 1),
                    }));
                    return;
                  }

                  setRenterFilters((current) => ({
                    ...current,
                    page: Math.max(1, current.page - 1),
                  }));
                }}
                disabled={!pagination.hasPreviousPage}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeView === "owner" && showOwnerView) {
                    setOwnerFilters((current) => ({
                      ...current,
                      page: pagination.hasNextPage
                        ? current.page + 1
                        : current.page,
                    }));
                    return;
                  }

                  setRenterFilters((current) => ({
                    ...current,
                    page: pagination.hasNextPage
                      ? current.page + 1
                      : current.page,
                  }));
                }}
                disabled={!pagination.hasNextPage}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[1.6rem] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-slate-950">
        {value}
      </p>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
