import type { PostingStatus } from "@/lib/postings/api";

/**
 * An expiry is stored as a UTC instant but chosen as a calendar day. The owner
 * picks a date in their own timezone and means "keep this live through the whole
 * of that day", so the conversion between the two lives here, on the client that
 * actually knows the timezone. The server never interprets one.
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
 * Renders a stored instant as the local calendar day for an `<input type="date">`.
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
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-");
}

/**
 * Converts a picked calendar day to the instant it ends at in the viewer's
 * timezone, so a listing stays live for the whole of the day the owner chose.
 */
export function toExpiryIsoValue(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function isExpiryInPast(value: string, now = Date.now()): boolean {
  const iso = toExpiryIsoValue(value);

  if (!iso) {
    return false;
  }

  return new Date(iso).getTime() <= now;
}

export function formatExpiryDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
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
