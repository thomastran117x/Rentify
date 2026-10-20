import { describe, expect, it } from "vitest";
import {
  describeDevice,
  formatAbsoluteTime,
  formatRelativeTime,
  isValidDateInput,
  toActivityDateRange,
  todayDateInputValue,
} from "@/lib/security-activity/format";

const NOW = new Date("2026-10-18T12:00:00.000Z");

function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe("formatRelativeTime", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [-300, "just now"],
    [5 * 60, "5 minutes ago"],
    [2 * 60 * 60, "2 hours ago"],
    [24 * 60 * 60, "yesterday"],
    [3 * 24 * 60 * 60, "3 days ago"],
    [14 * 24 * 60 * 60, "2 weeks ago"],
    [65 * 24 * 60 * 60, "2 months ago"],
    [400 * 24 * 60 * 60, "last year"],
  ])("formats %i seconds ago as %p", (seconds, expected) => {
    expect(formatRelativeTime(ago(seconds), NOW)).toBe(expected);
  });

  it("handles an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("Unknown time");
  });
});

describe("formatAbsoluteTime", () => {
  it("formats a valid timestamp and echoes an invalid one", () => {
    expect(formatAbsoluteTime(NOW.toISOString())).toMatch(/2026/);
    expect(formatAbsoluteTime("not-a-date")).toBe("not-a-date");
  });
});

describe("toActivityDateRange", () => {
  it("covers whole local days, with the To day included", () => {
    expect(toActivityDateRange("2026-10-01", "2026-10-07")).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 8).toISOString(),
    });
  });

  it("rolls the day after To over month ends", () => {
    expect(toActivityDateRange("", "2026-10-31").to).toBe(
      new Date(2026, 10, 1).toISOString(),
    );
  });

  it("leaves an empty or malformed side open", () => {
    expect(toActivityDateRange("", "")).toEqual({
      from: undefined,
      to: undefined,
    });
    expect(toActivityDateRange("10/01/2026", "")).toEqual({
      from: undefined,
      to: undefined,
    });
  });
});

describe("toActivityDateRange with out-of-range input", () => {
  it.each([
    ["0020-05-01"],
    ["0999-12-31"],
    ["20266-01-01"],
    ["2026-02-31"],
    ["2026-13-01"],
  ])("treats %s as no bound", (value) => {
    expect(toActivityDateRange(value, value)).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it("keeps the edge years", () => {
    expect(toActivityDateRange("1000-01-01", "9999-12-30")).toEqual({
      from: new Date(1000, 0, 1, 0, 0, 0).toISOString(),
      to: new Date(9999, 11, 31).toISOString(),
    });
  });
});

describe("isValidDateInput", () => {
  it.each([
    ["", true],
    ["2026-10-19", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["0020-05-01", false],
    ["20266-01-01", false],
    ["19-10-2026", false],
  ])("judges %p as %p", (value, expected) => {
    expect(isValidDateInput(value)).toBe(expected);
  });
});

describe("todayDateInputValue", () => {
  it("formats the local date with zero padding", () => {
    expect(todayDateInputValue(new Date(2026, 0, 5, 23, 30))).toBe(
      "2026-01-05",
    );
  });
});

describe("describeDevice", () => {
  it.each([
    [{ browser: "Chrome", os: "Windows" }, "Chrome on Windows"],
    [{ browser: "Firefox", os: null }, "Firefox"],
    [{ browser: null, os: "iOS" }, "iOS"],
    [{ browser: null, os: null }, "Unknown device"],
  ])("describes %o as %p", (item, expected) => {
    expect(describeDevice(item)).toBe(expected);
  });
});
