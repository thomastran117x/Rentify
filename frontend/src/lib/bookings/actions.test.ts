import { describe, expect, it } from "vitest";
import {
  canConvertBooking,
  canDecideBooking,
  canPayBooking,
} from "@/lib/bookings/actions";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const FUTURE = "2026-09-15T12:00:00.000Z";
const PAST = "2026-09-13T12:00:00.000Z";

describe("canDecideBooking", () => {
  it("allows pending requests whose hold is still active", () => {
    expect(canDecideBooking("pending", FUTURE, NOW)).toBe(true);
  });

  it("rejects expired holds, missing holds, and non-pending statuses", () => {
    expect(canDecideBooking("pending", PAST, NOW)).toBe(false);
    expect(canDecideBooking("pending", undefined, NOW)).toBe(false);
    expect(canDecideBooking("pending", "not-a-date", NOW)).toBe(false);
    expect(canDecideBooking("awaiting_payment", FUTURE, NOW)).toBe(false);
  });
});

describe("canPayBooking", () => {
  it("allows awaiting and failed payments with an active hold", () => {
    expect(
      canPayBooking("awaiting_payment", { holdExpiresAt: FUTURE }, NOW),
    ).toBe(true);
    expect(
      canPayBooking("payment_failed", { holdExpiresAt: FUTURE }, NOW),
    ).toBe(true);
  });

  it("rejects converted, expired, and ineligible bookings", () => {
    expect(
      canPayBooking(
        "awaiting_payment",
        { holdExpiresAt: FUTURE, rentingId: "renting-1" },
        NOW,
      ),
    ).toBe(false);
    expect(
      canPayBooking(
        "awaiting_payment",
        { holdExpiresAt: FUTURE, convertedAt: PAST },
        NOW,
      ),
    ).toBe(false);
    expect(
      canPayBooking("awaiting_payment", { holdExpiresAt: PAST }, NOW),
    ).toBe(false);
    expect(canPayBooking("pending", { holdExpiresAt: FUTURE }, NOW)).toBe(
      false,
    );
  });
});

describe("canConvertBooking", () => {
  it("allows paid bookings that are not yet converted", () => {
    expect(canConvertBooking("paid", {})).toBe(true);
  });

  it("rejects converted or unpaid bookings", () => {
    expect(canConvertBooking("paid", { rentingId: "renting-1" })).toBe(false);
    expect(canConvertBooking("paid", { convertedAt: PAST })).toBe(false);
    expect(canConvertBooking("awaiting_payment", {})).toBe(false);
  });
});
