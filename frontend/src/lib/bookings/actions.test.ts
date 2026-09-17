import { describe, expect, it } from "vitest";
import {
  canConvertBooking,
  canDecideBooking,
  canPayBooking,
  checkoutPath,
  payActionLabel,
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
  it("allows awaiting, in-progress, and failed payments with an active hold", () => {
    expect(
      canPayBooking("awaiting_payment", { holdExpiresAt: FUTURE }, NOW),
    ).toBe(true);
    expect(
      canPayBooking("payment_processing", { holdExpiresAt: FUTURE }, NOW),
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

describe("payActionLabel", () => {
  it("names the pay action after the booking's payment state", () => {
    expect(payActionLabel("awaiting_payment")).toBe("Pay now");
    expect(payActionLabel("payment_processing")).toBe("Continue checkout");
    expect(payActionLabel("payment_failed")).toBe("Retry payment");
  });
});

describe("checkoutPath", () => {
  it("links to the booking's checkout page", () => {
    expect(checkoutPath("booking 1")).toBe("/bookings/booking%201/checkout");
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
