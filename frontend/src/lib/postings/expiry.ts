import type { PostingStatus } from "@/lib/postings/api";

/**
 * An expiry is a calendar day, anchored to UTC.
 *
 * The owner picks a day and means "keep this live through the whole of it". We
 * store the end of that day *in UTC* rather than in the picker's own timezone,
 * so the stored instant always maps back to exactly the day that was chosen no
 * matter who opens the listing next. Anchoring to the picker's local zone looks
 * friendlier but does not round-trip: an owner in Los Angeles picking Sept 1
 * stores Sept 2 UTC, a teammate in Toronto opens it and sees Sept 2, and every
 * subsequent save walks the date forward another day and re-arms the reminder.
 *
 * The cost is that the deadline lands at 00:00 UTC rather than local midnight,
 * so the listing goes down a few hours early or late depending on the viewer.
 * That is a fixed, predictable offset; silent per-edit drift is not.
 */

export type ExpiryTone = "neutral" | "warning" | "expired";

export interface ExpiryDescription {
  label: string;
  tone: ExpiryTone;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Number of days out at which the dashboard starts calling an expiry imminent.
 * Matches the backend's default reminder lead time so the badge turns amber at
 * roughly the moment the owner gets the email.
 */
export const EXPIRY_WARNING_DAYS = 7;

export const EXPIRY_TONE_STYLES: Record<ExpiryTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  expired: "border-rose-200 bg-rose-50 text-rose-700",
};

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Renders a stored instant as the calendar day for an `<input type="date">`.
 *
 * Reads UTC parts so the day shown is the day that was picked, regardless of
 * the viewer's timezone.
 */
export function toExpiryInputValue(value?: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    date.getUTCFullYear(),
    padDatePart(date.getUTCMonth() + 1),
    padDatePart(date.getUTCDate()),
  ].join("-");
}

/**
 * Converts a picked calendar day to the instant that day ends at in UTC.
 */
export function toExpiryIsoValue(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day, 23, 59, 59, 999);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

export function isExpiryInPast(value: string, now = Date.now()): boolean {
  const iso = toExpiryIsoValue(value);

  if (!iso) {
    return false;
  }

  return new Date(iso).getTime() <= now;
}

/**
 * Formats a stored expiry as its calendar day. Reads UTC for the same reason
 * `toExpiryInputValue` does: the displayed day must be the day that was picked.
 */
export function formatExpiryDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Describes a posting's expiry for a status chip, or null when the listing has
 * no expiry and never expires.
 *
 * An already-archived posting reports nothing: it left the catalogue for a
 * different reason and an expiry chip would only be noise.
 */
export function describeExpiry(
  expiresAt: string | null | undefined,
  status: PostingStatus,
  now = Date.now(),
): ExpiryDescription | null {
  if (!expiresAt || status === "archived") {
    return null;
  }

  const timestamp = new Date(expiresAt).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  if (timestamp <= now) {
    return { label: "Expired", tone: "expired" };
  }

  const daysRemaining = Math.ceil((timestamp - now) / DAY_IN_MS);

  if (daysRemaining <= 1) {
    return { label: "Expires today", tone: "warning" };
  }

  return {
    label: `Expires in ${daysRemaining} days`,
    tone: daysRemaining <= EXPIRY_WARNING_DAYS ? "warning" : "neutral",
  };
}
