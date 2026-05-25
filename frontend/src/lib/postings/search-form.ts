function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function toDateTimeLocalValue(value?: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
    `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`,
  ].join("T");
}

export function toUtcIsoDateTime(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function buildSearchFormQuery(
  entries: Iterable<[string, FormDataEntryValue]>,
): URLSearchParams {
  const searchParams = new URLSearchParams();

  for (const [key, rawValue] of entries) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const normalizedValue = rawValue.trim();

    if (!normalizedValue) {
      continue;
    }

    const value =
      key === "startAt" || key === "endAt"
        ? (toUtcIsoDateTime(normalizedValue) ?? normalizedValue)
        : normalizedValue;
    searchParams.append(key, value);
  }

  return searchParams;
}
