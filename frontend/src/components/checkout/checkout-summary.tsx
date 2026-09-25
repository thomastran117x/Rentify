"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock, Users } from "lucide-react";
import type { CheckoutSummary } from "@/lib/payments/api";
import {
  formatDateRange,
  formatDateTime,
  formatMoney,
} from "@/lib/rentings/format";
import { ResponsiveImage } from "@/components/common/responsive-image";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const WARNING_THRESHOLD_MS = MS_PER_HOUR;
const URGENT_THRESHOLD_MS = 5 * MS_PER_MINUTE;

const CARD_CLASS =
  "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatPercent(bps: number): string {
  return `${bps / 100}%`;
}

function PriceRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        muted
          ? "text-slate-500 dark:text-slate-400"
          : "text-slate-700 dark:text-slate-200"
      }`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The order summary: what is being booked, then the money, in the column
 * order shoppers expect from a checkout page.
 */
export function CheckoutOrderSummary({
  summary,
}: {
  summary: CheckoutSummary;
}) {
  const { booking, posting, pricing } = summary;
  const money = (amount: number) => formatMoney(amount, pricing.currency);
  const depositLabel =
    pricing.depositBps === null
      ? "Deposit due today"
      : `Deposit due today (${formatPercent(pricing.depositBps)})`;
  const feeLabel =
    pricing.platformFeeBps === null
      ? "Platform fee"
      : `Platform fee (${formatPercent(pricing.platformFeeBps)})`;

  return (
    <section className={`${CARD_CLASS} overflow-hidden`}>
      <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-950 dark:border-slate-800 dark:text-white">
        Order summary
      </h2>

      <div className="flex gap-4 px-5 py-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          {posting.primaryPhotoUrl ? (
            <ResponsiveImage
              src={posting.primaryPhotoUrl}
              variants={posting.primaryPhotoVariants}
              sizes="80px"
              alt={posting.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,_#e2e8f0,_#f8fafc)] dark:bg-[linear-gradient(135deg,_#1e293b,_#0f172a)]" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
            {posting.name}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
            {formatDateRange(booking.startAt, booking.endAt)}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <Users aria-hidden="true" className="h-3.5 w-3.5" />
            {pluralize(booking.durationDays, "day")} ·{" "}
            {pluralize(booking.guestCount, "guest")}
          </p>
        </div>
      </div>

      <dl className="grid gap-2.5 border-t border-slate-200 px-5 py-4 text-sm dark:border-slate-800">
        {/* Weekly, monthly and seasonal pricing mean the stay total is not
            always the daily rate times the number of days. */}
        <PriceRow
          label="Daily rate"
          value={`${money(booking.dailyPriceAmount)} / day`}
          muted
        />
        <PriceRow
          label={`Stay total (${pluralize(booking.durationDays, "day")})`}
          value={money(pricing.stayTotal)}
        />
        <PriceRow label={depositLabel} value={money(pricing.depositAmount)} />
        <PriceRow label={feeLabel} value={money(pricing.platformFeeAmount)} />
      </dl>

      <div className="flex items-baseline justify-between gap-4 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
        <span className="text-base font-semibold text-slate-950 dark:text-white">
          Due today
        </span>
        <span className="text-xl font-semibold tabular-nums text-slate-950 dark:text-white">
          {money(pricing.totalDueNow)}
        </span>
      </div>

      <p className="border-t border-slate-200 px-5 py-3 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
        The remaining {money(pricing.remainingBalance)} is not charged by
        Rentify; arrange it with the host.
      </p>
    </section>
  );
}

export function CheckoutCancellationPolicy({
  summary,
}: {
  summary: CheckoutSummary;
}) {
  const policy = summary.cancellationPolicy;

  return (
    <section className={`${CARD_CLASS} px-5 py-4`}>
      <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
        Cancellation policy
      </h2>
      <ul className="mt-3 grid gap-1.5 text-sm text-slate-600 dark:text-slate-300">
        <li>
          Free cancellation more than {policy.fullRefundCutoffHours} hours
          before the start.
        </li>
        <li>
          {policy.partialRefundPercent}% refund between{" "}
          {policy.partialRefundCutoffHours} and {policy.fullRefundCutoffHours}{" "}
          hours before.
        </li>
        <li>
          No refund within {policy.partialRefundCutoffHours} hours of the start.
        </li>
        {policy.ownerCancellationFullRefund ? (
          <li>Full refund if the host cancels.</li>
        ) : null}
      </ul>
      {policy.hostNotes ? (
        <p className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <span className="font-medium text-slate-900 dark:text-white">
            Host notes:
          </span>{" "}
          <span className="whitespace-pre-line">{policy.hostNotes}</span>
        </p>
      ) : null}
    </section>
  );
}

export function formatHoldRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Counts down to the booking hold's expiry. The remaining time is derived
 * during render from a ticking clock (see account-email-panel), adjusted by
 * the server clock offset so a skewed device clock does not mislead the
 * renter. `onExpire` fires once per deadline.
 */
export function CheckoutHoldCountdown({
  holdExpiresAt,
  serverOffsetMs,
  onExpire,
}: {
  holdExpiresAt: string;
  serverOffsetMs: number;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = Date.parse(holdExpiresAt);
  const remainingMs = expiresAt - (now + serverOffsetMs);
  const expired = remainingMs <= 0;
  const expiredFor = useRef<number | null>(null);

  useEffect(() => {
    if (expired) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [expired]);

  useEffect(() => {
    if (!expired || expiredFor.current === expiresAt) {
      return;
    }

    expiredFor.current = expiresAt;
    onExpire();
  }, [expired, expiresAt, onExpire]);

  const tone =
    expired || remainingMs <= URGENT_THRESHOLD_MS
      ? "text-rose-700 dark:text-rose-300"
      : remainingMs <= WARNING_THRESHOLD_MS
        ? "text-amber-700 dark:text-amber-300"
        : "text-slate-600 dark:text-slate-300";

  return (
    <p
      role="timer"
      aria-live="off"
      className={`flex items-center gap-2 text-sm ${tone}`}
    >
      <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
      {expired ? (
        <span>Your booking hold has expired.</span>
      ) : (
        <span>
          <span className="font-semibold">
            Hold expires in {formatHoldRemaining(remainingMs)}
          </span>{" "}
          <span className="text-slate-500 dark:text-slate-400">
            · pay before {formatDateTime(holdExpiresAt)}
          </span>
        </span>
      )}
    </p>
  );
}
