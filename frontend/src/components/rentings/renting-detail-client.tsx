"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ReceiptText,
  Star,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { canManageOrganizationPostings } from "@/lib/auth/roles";
import { ApiError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { rentingsApi, type RentingRecord } from "@/lib/rentings/api";
import { paymentsApi, type PaymentRecord } from "@/lib/payments/api";
import {
  canDisputeRenting,
  formatDateRange,
  formatDateTime,
  formatMoney,
  humanizeStatus,
  statusClasses,
} from "@/lib/rentings/format";
import { theme } from "@/styles/theme";

type BannerTone = "error" | "success";

interface DetailBanner {
  tone: BannerTone;
  text: string;
}

interface RentingDetailClientProps {
  rentingId: string;
}

function bannerClasses(tone: BannerTone): string {
  return tone === "error"
    ? "border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200"
    : "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200";
}

interface TimelineStage {
  label: string;
  timestamp?: string;
}

function buildTimeline(renting: RentingRecord): TimelineStage[] {
  return [
    { label: "Confirmed", timestamp: renting.confirmedAt },
    { label: "Check-in ready", timestamp: renting.checkInReadyAt },
    { label: "Check-in completed", timestamp: renting.checkInCompletedAt },
    { label: "Return due", timestamp: renting.returnDueAt },
    { label: "Completed", timestamp: renting.completedAt },
  ];
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
    <section className="rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-2 text-slate-950 dark:text-white">
        {icon}
        <h2 className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function RentingDetailClient({ rentingId }: RentingDetailClientProps) {
  const router = useRouter();
  const { status, session } = useAuth();

  const [renting, setRenting] = useState<RentingRecord | null>(null);
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<DetailBanner | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pickupInstructions, setPickupInstructions] = useState("");
  const [returnInstructions, setReturnInstructions] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDetails, setDisputeDetails] = useState("");

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  const applyRenting = useCallback((record: RentingRecord) => {
    setRenting(record);
    setPickupInstructions(record.pickupInstructions ?? "");
    setReturnInstructions(record.returnInstructions ?? "");
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session) {
      return;
    }

    let active = true;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    setPaymentError(null);

    async function loadRenting() {
      try {
        const record = await rentingsApi.getById(rentingId);

        if (!active) {
          return;
        }

        applyRenting(record);

        try {
          const paymentRecord = await paymentsApi.getByBookingRequest(
            record.bookingRequestId,
          );

          if (active) {
            setPayment(paymentRecord);
            setPaymentError(null);
          }
        } catch (paymentErr) {
          if (!active) {
            return;
          }

          setPayment(null);

          // A genuine 404 means no receipt exists yet (soft empty state);
          // any other failure is operational and must surface as an error.
          if (paymentErr instanceof ApiError && paymentErr.status === 404) {
            setPaymentError(null);
          } else {
            setPaymentError(
              getApiErrorMessage(paymentErr, {
                action: "load the payment receipt",
                fallback:
                  "We couldn't load the payment receipt. Please try again.",
              }),
            );
          }
        }
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(
            getApiErrorMessage(error, {
              action: "load this renting",
              fallback:
                "We couldn't load this renting right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadRenting();

    return () => {
      active = false;
    };
  }, [applyRenting, rentingId, session, status]);

  const runMutation = useCallback(
    async (
      key: string,
      mutate: () => Promise<RentingRecord>,
      successText: string,
    ) => {
      setPendingAction(key);
      setBanner(null);

      try {
        const updated = await mutate();
        applyRenting(updated);
        setBanner({ tone: "success", text: successText });
      } catch (error) {
        setBanner({
          tone: "error",
          text: getApiErrorMessage(error, {
            action: "update this renting",
            fallback: "We couldn't complete that action. Please try again.",
          }),
        });
      } finally {
        setPendingAction(null);
      }
    },
    [applyRenting],
  );

  if (status === "loading" || (status === "authenticated" && loading)) {
    return (
      <main className={theme.marketplace.page}>
        <div className={theme.marketplace.background} aria-hidden="true" />
        <div className={theme.marketplace.container}>
          <div className="mx-auto max-w-3xl rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
            Loading renting details...
          </div>
        </div>
      </main>
    );
  }

  if (status === "anonymous") {
    return null;
  }

  if (notFound) {
    return (
      <RentingDetailMessage
        title="We couldn't find this renting."
        description="It may have been removed, or you may not have access to it."
      />
    );
  }

  if (loadError || !renting) {
    return (
      <RentingDetailMessage
        title="We couldn't load this renting right now."
        description={loadError ?? "Please try again in a moment."}
      />
    );
  }

  const activeOrg = session?.user.activeOrganization;
  // Mirror the backend's assertOwnerOrAdmin: only global admins are exempt from
  // needing a managing membership in the renting's own organization. A global
  // "owner" role alone does not grant management over another org's renting.
  const canManageAsOwner =
    session?.user.role === "admin" ||
    (canManageOrganizationPostings(activeOrg) &&
      activeOrg?.id === renting.organizationId);

  const timeline = buildTimeline(renting);
  const hasBothInstructions =
    pickupInstructions.trim().length > 0 &&
    returnInstructions.trim().length > 0;
  const disputeEligible = canDisputeRenting({
    status: renting.status,
    hasDispute: Boolean(renting.dispute),
    completedAt: renting.completedAt,
    endAt: renting.endAt,
  });
  const canLeaveReview = renting.status === "completed" && !renting.dispute;

  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <Link
            href="/bookings"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 transition hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to bookings
          </Link>

          {banner ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm font-medium ${bannerClasses(banner.tone)}`}
              role="status"
            >
              {banner.text}
            </div>
          ) : null}

          {/* Posting summary */}
          <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="grid gap-0 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div className="relative min-h-40 bg-slate-100 dark:bg-slate-800">
                {renting.posting.primaryPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={renting.posting.primaryPhotoUrl}
                    alt={renting.posting.name}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,_#e2e8f0,_#f8fafc)] dark:bg-[linear-gradient(135deg,_#1e293b,_#0f172a)]" />
                )}
              </div>
              <div className="px-6 py-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                    {renting.posting.name}
                  </h1>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusClasses(renting.status)}`}
                  >
                    {humanizeStatus(renting.status)}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                  <p>{formatDateRange(renting.startAt, renting.endAt)}</p>
                  <p>
                    {renting.durationDays} day
                    {renting.durationDays === 1 ? "" : "s"}
                  </p>
                  <p>
                    {renting.guestCount} guest
                    {renting.guestCount === 1 ? "" : "s"}
                  </p>
                  {formatDateTime(renting.confirmedAt) ? (
                    <p>Confirmed {formatDateTime(renting.confirmedAt)}</p>
                  ) : null}
                </div>
                <Link
                  href={`/postings/${renting.postingId}`}
                  className="mt-4 inline-flex text-sm font-semibold text-violet-700 dark:text-violet-300 transition hover:text-violet-900 dark:hover:text-violet-200"
                >
                  View posting
                </Link>
              </div>
            </div>
          </section>

          {/* Lifecycle timeline */}
          <Panel
            icon={
              <CheckCircle2
                className="h-5 w-5 text-emerald-500"
                aria-hidden="true"
              />
            }
            title="Lifecycle timeline"
          >
            <ol className="space-y-3">
              {timeline.map((stage) => {
                const done = Boolean(stage.timestamp);
                return (
                  <li key={stage.label} className="flex items-start gap-3">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${done ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}
                      aria-hidden="true"
                    />
                    <div className="text-sm">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {stage.label}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {formatDateTime(stage.timestamp) ?? "Pending"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {renting.dispute ? (
              <p className="mt-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                Dispute opened {formatDateTime(renting.disputedAt) ?? ""}
              </p>
            ) : null}
            {renting.cancelledAt ? (
              <p className="mt-4 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                Cancelled {formatDateTime(renting.cancelledAt) ?? ""}
              </p>
            ) : null}
          </Panel>

          {/* Instructions */}
          <Panel
            icon={
              <ClipboardList
                className="h-5 w-5 text-slate-500"
                aria-hidden="true"
              />
            }
            title="Pickup & return instructions"
          >
            {canManageAsOwner ? (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="pickup-instructions"
                    className="text-sm font-semibold text-slate-900 dark:text-white"
                  >
                    Pickup instructions
                  </label>
                  <textarea
                    id="pickup-instructions"
                    value={pickupInstructions}
                    onChange={(event) =>
                      setPickupInstructions(event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="return-instructions"
                    className="text-sm font-semibold text-slate-900 dark:text-white"
                  >
                    Return instructions
                  </label>
                  <textarea
                    id="return-instructions"
                    value={returnInstructions}
                    onChange={(event) =>
                      setReturnInstructions(event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-violet-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void runMutation(
                      "save-instructions",
                      () =>
                        rentingsApi.updateInstructions(renting.id, {
                          pickupInstructions,
                          returnInstructions,
                        }),
                      "Instructions saved.",
                    )
                  }
                  disabled={pendingAction === "save-instructions"}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 dark:bg-white px-4 text-sm font-semibold text-white dark:text-slate-900 transition hover:bg-slate-800 dark:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingAction === "save-instructions"
                    ? "Saving..."
                    : "Save instructions"}
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Pickup
                  </p>
                  <p className="mt-1 whitespace-pre-line">
                    {renting.pickupInstructions?.trim()
                      ? renting.pickupInstructions
                      : "The owner has not shared pickup instructions yet."}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Return
                  </p>
                  <p className="mt-1 whitespace-pre-line">
                    {renting.returnInstructions?.trim()
                      ? renting.returnInstructions
                      : "The owner has not shared return instructions yet."}
                  </p>
                </div>
              </div>
            )}
          </Panel>

          {/* Owner lifecycle actions */}
          {canManageAsOwner ? (
            <Panel
              icon={
                <CalendarDays
                  className="h-5 w-5 text-sky-500"
                  aria-hidden="true"
                />
              }
              title="Lifecycle actions"
            >
              <div className="flex flex-wrap gap-2">
                {renting.status === "confirmed" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void runMutation(
                        "check-in-ready",
                        () => rentingsApi.markCheckInReady(renting.id),
                        "Marked check-in ready.",
                      )
                    }
                    disabled={
                      pendingAction === "check-in-ready" || !hasBothInstructions
                    }
                    title={
                      hasBothInstructions
                        ? undefined
                        : "Add pickup and return instructions first."
                    }
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === "check-in-ready"
                      ? "Updating..."
                      : "Mark check-in ready"}
                  </button>
                ) : null}
                {["confirmed", "check_in_ready"].includes(renting.status) ? (
                  <button
                    type="button"
                    onClick={() =>
                      void runMutation(
                        "check-in-complete",
                        () => rentingsApi.markCheckInComplete(renting.id),
                        "Check-in confirmed.",
                      )
                    }
                    disabled={pendingAction === "check-in-complete"}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === "check-in-complete"
                      ? "Updating..."
                      : "Confirm check-in"}
                  </button>
                ) : null}
                {["active", "return_due"].includes(renting.status) ? (
                  <button
                    type="button"
                    onClick={() =>
                      void runMutation(
                        "complete-return",
                        () => rentingsApi.markReturnComplete(renting.id),
                        "Return confirmed.",
                      )
                    }
                    disabled={pendingAction === "complete-return"}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === "complete-return"
                      ? "Updating..."
                      : "Confirm return"}
                  </button>
                ) : null}
                {![
                  "confirmed",
                  "check_in_ready",
                  "active",
                  "return_due",
                ].includes(renting.status) ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No lifecycle actions are available for this renting.
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}

          {/* Payment receipt */}
          <Panel
            icon={
              <ReceiptText
                className="h-5 w-5 text-emerald-500"
                aria-hidden="true"
              />
            }
            title="Payment receipt"
          >
            {payment ? (
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600 dark:text-slate-300">
                    Rental subtotal
                  </dt>
                  <dd className="font-semibold text-slate-900 dark:text-white">
                    {formatMoney(
                      payment.rentalSubtotalAmount,
                      payment.pricingCurrency,
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-600 dark:text-slate-300">
                    Platform fee
                  </dt>
                  <dd className="font-semibold text-slate-900 dark:text-white">
                    {formatMoney(
                      payment.platformFeeAmount,
                      payment.pricingCurrency,
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-2">
                  <dt className="font-semibold text-slate-900 dark:text-white">
                    Total
                  </dt>
                  <dd className="font-semibold text-slate-900 dark:text-white">
                    {formatMoney(payment.totalAmount, payment.pricingCurrency)}
                  </dd>
                </div>
                {formatDateTime(payment.succeededAt) ? (
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-600 dark:text-slate-300">
                      Paid on
                    </dt>
                    <dd className="text-slate-600 dark:text-slate-300">
                      {formatDateTime(payment.succeededAt)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : paymentError ? (
              <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                {paymentError}
              </p>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                A receipt is not available for this renting yet.
              </p>
            )}
          </Panel>

          {/* Dispute */}
          <Panel
            icon={
              <AlertTriangle
                className="h-5 w-5 text-rose-500"
                aria-hidden="true"
              />
            }
            title="Dispute"
          >
            {renting.dispute ? (
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-slate-900 dark:text-white">
                  {renting.dispute.reason}
                </p>
                {renting.dispute.details ? (
                  <p className="whitespace-pre-line text-slate-600 dark:text-slate-300">
                    {renting.dispute.details}
                  </p>
                ) : null}
                <p className="text-slate-500 dark:text-slate-400">
                  Opened {formatDateTime(renting.dispute.createdAt) ?? ""}
                </p>
              </div>
            ) : disputeEligible ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={disputeReason}
                  onChange={(event) => setDisputeReason(event.target.value)}
                  placeholder="Reason"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-violet-500"
                />
                <textarea
                  value={disputeDetails}
                  onChange={(event) => setDisputeDetails(event.target.value)}
                  rows={3}
                  placeholder="Add any details (optional)"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-violet-500"
                />
                <button
                  type="button"
                  onClick={() =>
                    void runMutation(
                      "create-dispute",
                      () =>
                        rentingsApi.createDispute(renting.id, {
                          reason: disputeReason,
                          details: disputeDetails.trim()
                            ? disputeDetails
                            : null,
                        }),
                      "Dispute opened.",
                    )
                  }
                  disabled={
                    pendingAction === "create-dispute" ||
                    disputeReason.trim().length === 0
                  }
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-rose-300 dark:border-rose-800 px-4 text-sm font-semibold text-rose-700 dark:text-rose-300 transition hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingAction === "create-dispute"
                    ? "Submitting..."
                    : "Open dispute"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No dispute has been opened for this renting.
              </p>
            )}
          </Panel>

          {/* Review */}
          {canLeaveReview ? (
            <Panel
              icon={
                <Star className="h-5 w-5 text-amber-500" aria-hidden="true" />
              }
              title="Review"
            >
              <p className="text-sm text-slate-600 dark:text-slate-300">
                This renting is complete. Open the posting to read its reviews.
              </p>
              <Link
                href={`/postings/${renting.postingId}`}
                className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700"
              >
                View reviews
              </Link>
            </Panel>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function RentingDetailMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.container}>
        <section className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-xl shadow-slate-950/5 sm:p-10">
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-3xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {description}
          </p>
          <div className="mt-7">
            <Link href="/bookings" className={theme.marketplace.primaryButton}>
              Back to bookings
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
