import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidUtcDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  return (
    year > 0 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function getCurrentUtcDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isValidDateOfBirth(
  value: string,
  today = getCurrentUtcDateOnly(),
): boolean {
  return isValidUtcDateOnly(value) && value <= today;
}

export const dateOfBirthSchema = z
  .string()
  .regex(DATE_ONLY_PATTERN, "Date of birth must use YYYY-MM-DD format.")
  .refine(isValidUtcDateOnly, "Date of birth must be a real calendar date.")
  .refine(
    (value) => value <= getCurrentUtcDateOnly(),
    "Date of birth cannot be in the future.",
  );

export function toDateOfBirthPersistence(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDateOfBirthPersistence(value: Date): string {
  return value.toISOString().slice(0, 10);
}
