const RENTING_DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function formatDateRange(startAt: string, endAt: string): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`;
}

export function formatDateTime(value?: string): string | null {
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

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function humanizeStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusClasses(status: string): string {
  if (
    ["payment_failed", "declined", "expired", "cancelled", "refunded"].includes(
      status,
    )
  ) {
    return "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300";
  }

  if (status === "disputed") {
    return "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300";
  }

  if (
    ["pending", "approved", "awaiting_payment", "payment_processing"].includes(
      status,
    )
  ) {
    return "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300";
  }

  if (status === "paid" || status === "confirmed" || status === "completed") {
    return "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300";
  }

  if (
    status === "check_in_ready" ||
    status === "active" ||
    status === "return_due"
  ) {
    return "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300";
  }

  return "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
}

/**
 * Core review eligibility for a renting, shared by the bookings dashboard card
 * and the renting detail page. The backend is the authority (it also checks
 * that the rental actually completed in the past and that the reviewer is not
 * an organization member), so this only gates whether to offer the affordance.
 */
export function canReviewRenting(input: {
  status: string;
  hasDispute: boolean;
}): boolean {
  return input.status === "completed" && !input.hasDispute;
}

/**
 * Core dispute eligibility for a renting, shared by the bookings dashboard card
 * and the renting detail page. A dispute can be opened while a renting is
 * active or return due, or within the dispute window after completion, and only
 * when no dispute already exists.
 */
export function canDisputeRenting(input: {
  status: string;
  hasDispute: boolean;
  completedAt?: string;
  endAt: string;
}): boolean {
  if (input.hasDispute) {
    return false;
  }

  if (input.status === "active" || input.status === "return_due") {
    return true;
  }

  if (input.status !== "completed") {
    return false;
  }

  const anchor = input.completedAt ?? input.endAt;
  return Date.now() - new Date(anchor).getTime() <= RENTING_DISPUTE_WINDOW_MS;
}
