import { describe, expect, it } from "vitest";
import {
  MAX_EXPIRY_HORIZON_DAYS,
  describeExpiry,
  formatExpiryDate,
  isExpiryBeyondHorizon,
  isExpiryInPast,
  toExpiryInputValue,
  toExpiryIsoValue,
} from "@/lib/postings/expiry";

describe("toExpiryIsoValue", () => {
  it("maps a picked day to the end of that day in UTC", () => {
    // Anchored to UTC rather than the picker's zone so the value round-trips
    // to the same calendar day for every viewer.
    expect(toExpiryIsoValue("2026-09-01")).toBe("2026-09-01T23:59:59.999Z");
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

  it.each([
    ["spring-forward", "2026-03-08"],
    ["fall-back", "2026-11-01"],
    ["leap day", "2028-02-29"],
    ["year end", "2026-12-31"],
  ])("round-trips across a %s boundary", (_label, day) => {
    expect(toExpiryInputValue(toExpiryIsoValue(day))).toBe(day);
  });

  it("reads back the picked day for viewers on either side of UTC", () => {
    // The regression this guards: with a local-zone anchor, an owner west of
    // UTC stored the *next* UTC day, so a teammate east of them saw a different
    // date and every save walked it forward again.
    const stored = toExpiryIsoValue("2026-09-01") as string;
    const asUtcDay = new Date(stored).toISOString().slice(0, 10);

    expect(asUtcDay).toBe("2026-09-01");
    expect(toExpiryInputValue(stored)).toBe("2026-09-01");
  });

  it("is stable under repeated edit-and-save cycles", () => {
    let value = "2026-09-01";

    for (let index = 0; index < 5; index += 1) {
      value = toExpiryInputValue(toExpiryIsoValue(value));
    }

    expect(value).toBe("2026-09-01");
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
  it("renders the picked calendar day, not the viewer's local day", () => {
    const formatted = formatExpiryDate(
      toExpiryIsoValue("2026-09-01") as string,
    );

    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/Sep/i);
    expect(formatted).toMatch(/Sep 1, 2026/);
  });
});

describe("isExpiryBeyondHorizon", () => {
  const now = new Date("2026-08-23T12:00:00.000Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  function dayOffsetFromNow(days: number): string {
    return new Date(now + days * dayMs).toISOString().slice(0, 10);
  }

  it("accepts a date inside the supported horizon", () => {
    expect(isExpiryBeyondHorizon(dayOffsetFromNow(365), now)).toBe(false);
  });

  it("rejects a date past the horizon", () => {
    // Guards the gap the wizard had: the backend rejects these, so the field
    // has to say so before submission rather than failing on save.
    expect(
      isExpiryBeyondHorizon(
        dayOffsetFromNow(MAX_EXPIRY_HORIZON_DAYS + 30),
        now,
      ),
    ).toBe(true);
    expect(isExpiryBeyondHorizon("2099-01-01", now)).toBe(true);
  });

  it("treats a blank value as within the horizon", () => {
    expect(isExpiryBeyondHorizon("", now)).toBe(false);
  });
});
