import { describe, expect, it } from "vitest";
import {
  describeExpiry,
  formatExpiryDate,
  isExpiryInPast,
  toExpiryInputValue,
  toExpiryIsoValue,
} from "@/lib/postings/expiry";

describe("toExpiryIsoValue", () => {
  it("maps a picked day to the end of that day in the viewer's timezone", () => {
    const iso = toExpiryIsoValue("2026-09-01");

    expect(iso).not.toBeNull();
    const date = new Date(iso as string);
    // The whole point: the listing stays live through the entire chosen day.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(23);
    expect(date.getMinutes()).toBe(59);
  });

  it("treats a blank value as no expiry", () => {
    expect(toExpiryIsoValue("")).toBeNull();
    expect(toExpiryIsoValue("   ")).toBeNull();
  });

  it("rejects a malformed value", () => {
    expect(toExpiryIsoValue("not-a-date")).toBeNull();
    expect(toExpiryIsoValue("2026-09")).toBeNull();
  });
});

describe("toExpiryInputValue", () => {
  it("round-trips a picked day back to the same input value", () => {
    const iso = toExpiryIsoValue("2026-09-01");

    expect(toExpiryInputValue(iso)).toBe("2026-09-01");
  });

  it("round-trips across a spring-forward boundary", () => {
    // 2026-03-08 is the US DST transition; the local end-of-day still belongs to
    // the same calendar day when read back.
    const iso = toExpiryIsoValue("2026-03-08");

    expect(toExpiryInputValue(iso)).toBe("2026-03-08");
  });

  it("round-trips across a fall-back boundary", () => {
    const iso = toExpiryIsoValue("2026-11-01");

    expect(toExpiryInputValue(iso)).toBe("2026-11-01");
  });

  it("returns a blank string for missing or invalid input", () => {
    expect(toExpiryInputValue(undefined)).toBe("");
    expect(toExpiryInputValue(null)).toBe("");
    expect(toExpiryInputValue("")).toBe("");
    expect(toExpiryInputValue("not-a-date")).toBe("");
  });
});

describe("isExpiryInPast", () => {
  const now = new Date("2026-08-19T12:00:00.000Z").getTime();

  it("accepts a day still ahead", () => {
    expect(isExpiryInPast("2026-12-01", now)).toBe(false);
  });

  it("rejects a day already gone", () => {
    expect(isExpiryInPast("2020-01-01", now)).toBe(true);
  });

  it("treats a blank value as not expired", () => {
    expect(isExpiryInPast("", now)).toBe(false);
  });
});

describe("describeExpiry", () => {
  const now = new Date("2026-08-19T12:00:00.000Z").getTime();

  it("reports nothing when the listing never expires", () => {
    expect(describeExpiry(undefined, "published", now)).toBeNull();
    expect(describeExpiry(null, "published", now)).toBeNull();
  });

  it("reports nothing for an archived posting", () => {
    // Archiving is a different reason to leave the catalogue; an expiry chip
    // there would only be noise.
    expect(
      describeExpiry("2026-08-25T23:59:59.999Z", "archived", now),
    ).toBeNull();
  });

  it("reports nothing for an unparseable date", () => {
    expect(describeExpiry("not-a-date", "published", now)).toBeNull();
  });

  it("marks a passed date as expired", () => {
    expect(describeExpiry("2026-08-18T23:59:59.999Z", "paused", now)).toEqual({
      label: "Expired",
      tone: "expired",
    });
  });

  it("marks the current day as expiring today", () => {
    expect(
      describeExpiry("2026-08-19T23:59:59.999Z", "published", now),
    ).toEqual({
      label: "Expires today",
      tone: "warning",
    });
  });

  it("warns inside the lead window", () => {
    const result = describeExpiry("2026-08-23T23:59:59.999Z", "published", now);

    expect(result?.tone).toBe("warning");
    expect(result?.label).toMatch(/^Expires in \d+ days$/);
  });

  it("stays neutral well ahead of the deadline", () => {
    const result = describeExpiry("2026-11-01T23:59:59.999Z", "published", now);

    expect(result?.tone).toBe("neutral");
    expect(result?.label).toMatch(/^Expires in \d+ days$/);
  });
});

describe("formatExpiryDate", () => {
  it("renders a readable calendar date", () => {
    const formatted = formatExpiryDate(
      toExpiryIsoValue("2026-09-01") as string,
    );

    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/Sep/i);
  });
});
