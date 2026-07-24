import BadRequestError from "@/errors/http/bad-request.error";

export interface CalendarDayWindow {
  /** `YYYY-MM-DD` label in the resolved timezone. */
  date: string;
  /** Inclusive UTC start instant of this local day. */
  startUtc: Date;
  /** Exclusive UTC end instant of this local day (start of the next local day). */
  endUtc: Date;
}

interface ZonedYmd {
  year: number;
  month: number;
  day: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  partsFormatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * Validates an optional IANA timezone name and returns it, defaulting to `UTC`.
 * Throws a {@link BadRequestError} when the timezone is not recognised by the
 * runtime's Intl implementation.
 */
export function resolveTimeZone(timeZone?: string): string {
  if (!timeZone) {
    return "UTC";
  }

  try {
    // Constructing the formatter throws `RangeError` for invalid zones.
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    throw new BadRequestError(`Unknown timezone: ${timeZone}.`);
  }
}

function readZonedParts(
  instant: Date,
  timeZone: string,
): ZonedYmd & {
  hour: number;
  minute: number;
  second: number;
} {
  const parts = getPartsFormatter(timeZone).formatToParts(instant);
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // Some runtimes emit hour "24" for midnight; normalise to 0.
    hour: values.hour % 24,
    minute: values.minute,
    second: values.second,
  };
}

/**
 * Offset (in ms) that must be added to a UTC instant to obtain the wall-clock
 * time in `timeZone` at that instant.
 */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = readZonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a wall-clock date/time in `timeZone` into the corresponding UTC
 * instant. Uses a two-pass correction so DST transitions are handled.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = timeZoneOffsetMs(new Date(wallClockAsUtc), timeZone);
  let instant = wallClockAsUtc - firstOffset;
  const secondOffset = timeZoneOffsetMs(new Date(instant), timeZone);

  if (secondOffset !== firstOffset) {
    instant = wallClockAsUtc - secondOffset;
  }

  return new Date(instant);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Number of days in the given 1-based month.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Ordered day windows for every day of the requested month, expressed as UTC
 * instant ranges for the day boundaries in `timeZone`. The optional
 * `lookAheadDays` appends additional consecutive day windows past month end so
 * callers can evaluate minimum-duration validity for late-month start dates.
 */
export function buildMonthDayWindows(
  year: number,
  month: number,
  timeZone: string,
  lookAheadDays = 0,
): CalendarDayWindow[] {
  const totalDays = daysInMonth(year, month) + Math.max(0, lookAheadDays);
  const windows: CalendarDayWindow[] = [];
  let previousEnd = zonedTimeToUtc(year, month, 1, timeZone);

  for (let offset = 0; offset < totalDays; offset += 1) {
    // Passing day = 1 + offset lets Date.UTC normalise rollover into the next
    // month/year, and zonedTimeToUtc re-derives the correct offset per day.
    const startUtc = previousEnd;
    const endUtc = zonedTimeToUtc(year, month, 1 + offset + 1, timeZone);
    const labelParts = readZonedParts(startUtc, timeZone);
    windows.push({
      date: `${labelParts.year}-${pad2(labelParts.month)}-${pad2(labelParts.day)}`,
      startUtc,
      endUtc,
    });
    previousEnd = endUtc;
  }

  return windows;
}

/**
 * Earliest bookable UTC instant given an advance-notice window. Days whose
 * `startUtc` is before this threshold fall inside the advance-notice window.
 * Returns `undefined` when no advance notice applies.
 *
 * This deliberately mirrors the booking endpoint's advance-notice check
 * (`checkBookingDateConstraints`), which compares against UTC midnight today
 * plus `advanceNoticeDays`. Computing the cutoff in UTC (rather than the
 * calendar's display timezone) keeps the calendar from advertising a start date
 * the booking API would reject near timezone/date boundaries.
 */
export function advanceNoticeThreshold(
  now: Date,
  advanceNoticeDays: number | undefined,
): Date | undefined {
  if (!advanceNoticeDays || advanceNoticeDays <= 0) {
    return undefined;
  }

  const minStart = new Date(now);
  minStart.setUTCHours(0, 0, 0, 0);
  minStart.setUTCDate(minStart.getUTCDate() + advanceNoticeDays);
  return minStart;
}
