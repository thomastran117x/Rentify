import { describe, expect, it } from "vitest";
import {
  describeDevice,
  formatAbsoluteTime,
  formatRelativeTime,
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
