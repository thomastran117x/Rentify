"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Clock, ShieldCheck, Users } from "lucide-react";
import type { CheckoutSummary } from "@/lib/payments/api";
import {
  formatDateRange,
  formatDateTime,
  formatMoney,
} from "@/lib/rentings/format";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const WARNING_THRESHOLD_MS = MS_PER_HOUR;
const URGENT_THRESHOLD_MS = 5 * MS_PER_MINUTE;

export function CheckoutPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
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

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatPercent(bps: number): string {
  return `${bps / 100}%`;
}

export function CheckoutBookingHeader({
  summary,
}: {
  summary: CheckoutSummary;
}) {
  const { booking, posting } = summary;

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="grid sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="relative min-h-36 bg-slate-100 dark:bg-slate-800">
          {posting.primaryPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={posting.primaryPhotoUrl}
              alt={posting.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,_#e2e8f0,_#f8fafc)] dark:bg-[linear-gradient(135deg,_#1e293b,_#0f172a)]" />
          )}
        </div>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
            Checkout
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            {posting.name}
          </h1>
          <dl className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              <dt className="sr-only">Dates</dt>
              <dd>
                {formatDateRange(booking.startAt, booking.endAt)} ·{" "}
                {pluralize(booking.durationDays, "day")}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <Users aria-hidden="true" className="h-4 w-4" />
              <dt className="sr-only">Guests</dt>
              <dd>{pluralize(booking.guestCount, "guest")}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function PriceRow({
  label,
  value,
  emphasis = false,
  muted = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        emphasis
          ? "border-t border-slate-200 pt-3 text-base font-semibold text-slate-950 dark:border-slate-700 dark:text-white"
          : muted
            ? "text-slate-500 dark:text-slate-400"
            : "text-slate-700 dark:text-slate-200"
      }`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export function CheckoutPriceBreakdown({
  summary,
}: {
  summary: CheckoutSummary;
}) {
  const { booking, pricing } = summary;
  const money = (amount: number) => formatMoney(amount, pricing.currency);
  const depositLabel =
    pricing.depositBps === null
      ? "Deposit due today"
      : `Deposit due today (${formatPercent(pricing.depositBps)})`;
  const feeLabel =
    pricing.platformFeeBps === null
      ? "Platform fee"
      : `Platform fee (${formatPercent(pricing.platformFeeBps)} of deposit)`;

  return (
    <CheckoutPanel title="Price details">
      <dl className="grid gap-3 text-sm">
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
        <PriceRow
          label="Charged today"
          value={money(pricing.totalDueNow)}
          emphasis
        />
        <PriceRow
          label="Remaining balance"
          value={money(pricing.remainingBalance)}
          muted
        />
      </dl>
      <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        Rentify charges only the deposit and platform fee today. The remaining
        balance is not charged by Rentify; arrange it with the host.
      </p>
    </CheckoutPanel>
  );
}

export function CheckoutCancellationPolicy({
  summary,
}: {
  summary: CheckoutSummary;
}) {
  const policy = summary.cancellationPolicy;

  return (
    <CheckoutPanel
      title="Cancellation policy"
      icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" />}
    >
      <ul className="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
        <li>
          Cancel more than {policy.fullRefundCutoffHours} hours before your stay
          starts for a full refund of what you paid today.
        </li>
        <li>
          Cancel {policy.partialRefundCutoffHours} to{" "}
          {policy.fullRefundCutoffHours} hours before the start for a{" "}
          {policy.partialRefundPercent}% refund.
        </li>
        <li>
          Cancellations within {policy.partialRefundCutoffHours} hours of the
          start are not refunded.
        </li>
        {policy.ownerCancellationFullRefund ? (
          <li>If the host cancels, you get a full refund.</li>
        ) : null}
      </ul>
      {policy.hostNotes ? (
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
          <p className="font-medium text-slate-900 dark:text-white">
            Notes from the host
          </p>
          <p className="mt-1 whitespace-pre-line">{policy.hostNotes}</p>
        </div>
      ) : null}
    </CheckoutPanel>
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
    remainingMs <= URGENT_THRESHOLD_MS
      ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
      : remainingMs <= WARNING_THRESHOLD_MS
        ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
        : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200";

  return (
    <div
      role="timer"
      aria-live="off"
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${tone}`}
    >
      <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">
          {expired
            ? "Your booking hold has expired"
            : `Hold expires in ${formatHoldRemaining(remainingMs)}`}
        </p>
        <p className="mt-0.5 text-xs opacity-80">
          {expired
            ? "Payment is no longer available for this booking."
            : `Pay before ${formatDateTime(holdExpiresAt)} to keep these dates.`}
          {!expired && remainingMs <= URGENT_THRESHOLD_MS
            ? " Finish soon."
            : ""}
        </p>
      </div>
    </div>
  );
}
