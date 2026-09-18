"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { BookingMessagesPanel } from "@/components/bookings/booking-messages-panel";
import { ApiError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  canConvertBooking,
  canDecideBooking,
  canPayBooking,
  checkoutPath,
  payActionLabel,
} from "@/lib/bookings/actions";
import { bookingsApi } from "@/lib/bookings/api";
import type {
  BookingRequestRecord,
  BookingViewerAccess,
} from "@/lib/bookings/types";
import {
  formatDateRange,
  formatMoney,
  humanizeStatus,
  statusClasses,
} from "@/lib/rentings/format";

const DECISION_NOTE_MAX_LENGTH = 1000;
const PRIMARY_ACTION_CLASSES =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-white px-4 text-sm font-semibold text-white dark:text-slate-900 transition hover:bg-slate-800 dark:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_ACTION_CLASSES =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

type ActionKey = "approve" | "decline" | "convert";

interface ActionFeedback {
  tone: "error" | "success";
  text: string;
}

interface BookingDetailClientProps {
  bookingRequestId: string;
}

function DetailMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-8 text-center shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-950 dark:text-white">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {description}
        </p>
        <Link
          href="/bookings"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-300 hover:text-violet-700 dark:border-slate-700 dark:text-slate-200"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to bookings
        </Link>
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-950 dark:text-white">
        {icon}
        <h2 className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function BookingDetailClient({
  bookingRequestId,
}: BookingDetailClientProps) {
  const router = useRouter();
  const { status, session } = useAuth();

  const [booking, setBooking] = useState<BookingRequestRecord | null>(null);
  // Kept apart from the booking: only the single-booking read returns it, and
  // decision responses replace the booking without it.
  const [viewerAccess, setViewerAccess] = useState<BookingViewerAccess | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [declineFormOpen, setDeclineFormOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !session) {
      return;
    }

    let active = true;

    async function loadBooking() {
      setLoading(true);

      try {
        const record = await bookingsApi.getBookingById(bookingRequestId);

        if (!active) {
          return;
        }

        startTransition(() => {
          setBooking(record);
          setViewerAccess(record.viewerAccess ?? null);
        });
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else if (error instanceof ApiError && error.status === 403) {
          setForbidden(true);
        } else {
          setErrorText(
            getApiErrorMessage(error, {
              action: "load booking",
              fallback: "We could not load this booking request.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadBooking();

    return () => {
      active = false;
    };
  }, [bookingRequestId, session, status]);

  if (status === "loading" || (loading && !notFound && !forbidden)) {
    return (
      <DetailMessage
        title="Loading booking"
        description="Fetching this booking request and its conversation."
      />
    );
  }

  if (notFound) {
    return (
      <DetailMessage
        title="Booking not found"
        description="This booking request does not exist or has been removed."
      />
    );
  }

  if (forbidden) {
    return (
      <DetailMessage
        title="You do not have access"
        description="Only the renter and the owning organization can view this booking request."
      />
    );
  }

  if (errorText || !booking || !session) {
    return (
      <DetailMessage
        title="Something went wrong"
        description={errorText ?? "We could not load this booking request."}
      />
    );
  }

  const currentBooking = booking;
  // Resolved by the API against the booking's organization, so the offered
  // actions match what the manage-level endpoints will accept.
  const isRenter = viewerAccess?.side === "renter";
  const isManager =
    viewerAccess?.side === "owner" && viewerAccess.canManage === true;
  const conversionState = {
    convertedAt: currentBooking.convertedAt,
    rentingId: currentBooking.rentingId,
  };
  const showDecisionActions =
    isManager &&
    canDecideBooking(currentBooking.status, currentBooking.holdExpiresAt);
  const showConvertAction =
    isManager && canConvertBooking(currentBooking.status, conversionState);
  const showPayAction =
    isRenter &&
    canPayBooking(currentBooking.status, {
      ...conversionState,
      holdExpiresAt: currentBooking.holdExpiresAt,
    });
  const hasActions = showDecisionActions || showConvertAction || showPayAction;

  async function runAction(
    key: ActionKey,
    action: string,
    fallback: string,
    request: () => Promise<void>,
  ) {
    setPendingAction(key);
    setFeedback(null);

    try {
      await request();
    } catch (error) {
      setFeedback({
        tone: "error",
        // Rejections such as a request that was already decided carry a
        // reason the viewer can act on, so surface it over the fallback.
        text: getApiErrorMessage(error, {
          action,
          fallback,
          preserveClientMessage: true,
        }),
      });
    } finally {
      setPendingAction(null);
    }
  }

  function handleApprove() {
    return runAction(
      "approve",
      "approve this booking request",
      "Booking request could not be approved.",
      async () => {
        const record = await bookingsApi.approve(currentBooking.id);
        setBooking(record);
        setFeedback({
          tone: "success",
          text: "Booking request approved. The renter has been asked to pay.",
        });
      },
    );
  }

  function handleDecline() {
    return runAction(
      "decline",
      "decline this booking request",
      "Booking request could not be declined.",
      async () => {
        const record = await bookingsApi.decline(currentBooking.id, {
          note: declineNote.trim() || null,
        });
        setBooking(record);
        setDeclineFormOpen(false);
        setDeclineNote("");
        setFeedback({ tone: "success", text: "Booking request declined." });
      },
    );
  }

  function handleConvert() {
    return runAction(
      "convert",
      "convert this booking into a renting",
      "Booking could not be converted into a renting.",
      async () => {
        const renting = await bookingsApi.convertToRenting(currentBooking.id);
        router.push(`/rentings/${renting.id}`);
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/bookings"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-violet-700 dark:text-slate-300"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to bookings
      </Link>

      <div className="mt-6 flex flex-col gap-6">
        <Panel
          icon={<CalendarDays aria-hidden="true" className="h-5 w-5" />}
          title={currentBooking.posting.name}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(currentBooking.status)}`}
            >
              {humanizeStatus(currentBooking.status)}
            </span>
            <span>
              {formatDateRange(currentBooking.startAt, currentBooking.endAt)}
            </span>
            <span>
              {formatMoney(
                currentBooking.estimatedTotal,
                currentBooking.pricingCurrency,
              )}
            </span>
          </div>
          {currentBooking.note ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {currentBooking.note}
            </p>
          ) : null}
          {currentBooking.decisionNote ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-900 dark:text-white">
                Owner note:
              </span>{" "}
              {currentBooking.decisionNote}
            </p>
          ) : null}

          {feedback ? (
            <div
              role={feedback.tone === "error" ? "alert" : "status"}
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                feedback.tone === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
              }`}
            >
              {feedback.text}
            </div>
          ) : null}

          {hasActions || currentBooking.rentingId ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {showDecisionActions ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleApprove()}
                    disabled={pendingAction !== null}
                    className={PRIMARY_ACTION_CLASSES}
                  >
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                    {pendingAction === "approve" ? "Approving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclineFormOpen((open) => !open)}
                    aria-expanded={declineFormOpen}
                    disabled={pendingAction !== null}
                    className={SECONDARY_ACTION_CLASSES}
                  >
                    <XCircle aria-hidden="true" className="h-4 w-4" />
                    Decline
                  </button>
                </>
              ) : null}
              {showConvertAction ? (
                <button
                  type="button"
                  onClick={() => void handleConvert()}
                  disabled={pendingAction !== null}
                  className={PRIMARY_ACTION_CLASSES}
                >
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                  {pendingAction === "convert"
                    ? "Converting..."
                    : "Convert to renting"}
                </button>
              ) : null}
              {showPayAction ? (
                <Link
                  href={checkoutPath(currentBooking.id)}
                  className={PRIMARY_ACTION_CLASSES}
                >
                  <CircleDollarSign aria-hidden="true" className="h-4 w-4" />
                  {payActionLabel(currentBooking.status)}
                </Link>
              ) : null}
              {currentBooking.rentingId ? (
                <Link
                  href={`/rentings/${currentBooking.rentingId}`}
                  className={SECONDARY_ACTION_CLASSES}
                >
                  View renting
                </Link>
              ) : null}
            </div>
          ) : null}

          {showDecisionActions && declineFormOpen ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 dark:border-rose-900/50 dark:bg-rose-950/40">
              <label className="grid gap-2 text-sm text-rose-950 dark:text-rose-100">
                <span className="font-medium">Decline note (optional)</span>
                <textarea
                  value={declineNote}
                  onChange={(event) => setDeclineNote(event.target.value)}
                  rows={3}
                  maxLength={DECISION_NOTE_MAX_LENGTH}
                  className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-rose-500 dark:border-rose-900/50 dark:bg-slate-900 dark:text-white"
                  placeholder="Let the renter know why this request can't be accepted."
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleDecline()}
                  disabled={pendingAction !== null}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-700 px-5 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <XCircle aria-hidden="true" className="h-4 w-4" />
                  {pendingAction === "decline"
                    ? "Declining..."
                    : "Confirm decline"}
                </button>
              </div>
            </div>
          ) : null}
        </Panel>

        <BookingMessagesPanel
          bookingRequestId={currentBooking.id}
          currentUserId={session.user.id}
        />
      </div>
    </div>
  );
}
