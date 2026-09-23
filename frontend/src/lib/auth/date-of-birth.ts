const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getCurrentUtcDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function validateDateOfBirth(value: string): string | null {
  if (!value) {
    return "Date of birth is required.";
  }

  if (!DATE_ONLY_PATTERN.test(value)) {
    return "Enter a valid date of birth.";
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  if (
    year === 0 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return "Enter a valid date of birth.";
  }

  if (value > getCurrentUtcDateOnly()) {
    return "Date of birth cannot be in the future.";
  }

  return null;
}
