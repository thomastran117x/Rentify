import type { SecurityActivityItem } from "@/lib/security-activity/types";

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/**
 * "just now", "5 minutes ago", "yesterday", "3 weeks ago". Times in the future
 * (clock skew between browser and server) read as "just now".
 */
export function formatRelativeTime(
  value: string,
  now: Date = new Date(),
): string {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "Unknown time";
  }

  const elapsedSeconds = Math.round((now.getTime() - timestamp) / 1000);

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (elapsedSeconds >= seconds) {
      return formatter.format(-Math.floor(elapsedSeconds / seconds), unit);
    }
  }

  return "just now";
}

/** Full local date and time, for the hover title next to a relative time. */
export function formatAbsoluteTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Turns the From and To values of `<input type="date">` (local calendar days)
 * into the API's `from` (inclusive) and `to` (exclusive) bounds, so the whole
 * To day is included. Empty or malformed values leave that side open.
 */
export function toActivityDateRange(
  fromDate: string,
  toDate: string,
): { from?: string; to?: string } {
  const from = parseDateInput(fromDate);
  const to = parseDateInput(toDate);

  if (to) {
    to.setDate(to.getDate() + 1);
  }

  return {
    from: from ? from.toISOString() : undefined,
    to: to ? to.toISOString() : undefined,
  };
}

/** Today's local date in the `YYYY-MM-DD` form date inputs use. */
export function todayDateInputValue(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function describeDevice(
  item: Pick<SecurityActivityItem, "browser" | "os">,
): string {
  if (item.browser && item.os) {
    return `${item.browser} on ${item.os}`;
  }

  return item.browser ?? item.os ?? "Unknown device";
}
