import { describe, expect, it } from "vitest";
import {
  buildSavedSearchHref,
  describeSavedSearchFilters,
  hasSavedSearchFilters,
  readSavedSearchParams,
} from "@/lib/saved-searches/query";

function read(query: string) {
  return readSavedSearchParams(new URLSearchParams(query));
}

describe("readSavedSearchParams", () => {
  it("keeps the filters and drops the presentation parameters", () => {
    // Paging through results and then saving must store the same search the
    // visitor saw on page one.
    expect(
      read("q=kayak&family=equipment&page=3&pageSize=50&sort=newest"),
    ).toEqual({
      q: "kayak",
      family: "equipment",
    });
  });

  it("drops parameters the search does not support", () => {
    // The backend validates strictly, so forwarding a stray parameter would
    // turn a save into a 400 the visitor cannot act on.
    expect(read("q=kayak&utm_source=newsletter")).toEqual({ q: "kayak" });
  });

  it("coerces numeric filters and ignores unparseable ones", () => {
    expect(read("minDailyPrice=20&maxDailyPrice=abc")).toEqual({
      minDailyPrice: 20,
    });
  });

  it("reads instantBooking only when it is an explicit boolean", () => {
    expect(read("instantBooking=true")).toEqual({ instantBooking: true });
    expect(read("instantBooking=false")).toEqual({ instantBooking: false });
    expect(read("instantBooking=maybe")).toEqual({});
  });

  it("accepts tags repeated or comma-separated, and de-duplicates them", () => {
    expect(read("tags=boat&tags=water,boat").tags).toEqual(["boat", "water"]);
  });

  it("ignores blank values rather than storing empty filters", () => {
    expect(read("q=%20%20&minDailyPrice=")).toEqual({});
  });
});

describe("hasSavedSearchFilters", () => {
  it("rejects an empty search, which would match the whole marketplace", () => {
    expect(hasSavedSearchFilters({})).toBe(false);
  });

  it("rejects a search whose only array filter is empty", () => {
    expect(hasSavedSearchFilters({ tags: [] })).toBe(false);
  });

  it("accepts a search with any filter set", () => {
    expect(hasSavedSearchFilters({ q: "kayak" })).toBe(true);
    expect(hasSavedSearchFilters({ instantBooking: false })).toBe(true);
  });
});

describe("buildSavedSearchHref", () => {
  it("round-trips every stored filter back into the browse URL", () => {
    const params = read(
      "q=kayak&family=equipment&tags=boat&minDailyPrice=10&maxDailyPrice=90" +
        "&latitude=1&longitude=2&radiusKm=5&availabilityStatus=available" +
        "&cancellationPolicy=flexible&instantBooking=true" +
        "&maxMinBookingDurationDays=3",
    );

    const href = buildSavedSearchHref(params);
    const roundTripped = read(href.slice(href.indexOf("?") + 1));

    expect(roundTripped).toEqual(params);
  });

  it("carries the three filters that have no form field of their own", () => {
    // These were previously dropped by the href builder. A saved search is the
    // only thing that round-trips through it, so the gap became data loss.
    const href = buildSavedSearchHref({
      cancellationPolicy: "moderate",
      instantBooking: true,
      maxMinBookingDurationDays: 7,
    });

    expect(href).toContain("cancellationPolicy=moderate");
    expect(href).toContain("instantBooking=true");
    expect(href).toContain("maxMinBookingDurationDays=7");
  });
});

describe("describeSavedSearchFilters", () => {
  it("describes the filters that identify a search", () => {
    expect(
      describeSavedSearchFilters({
        q: "kayak",
        family: "equipment",
        maxDailyPrice: 60,
      }),
    ).toEqual(['"kayak"', "Equipment", "under $60/day"]);
  });

  it("collapses a price range into one chip", () => {
    expect(
      describeSavedSearchFilters({ minDailyPrice: 20, maxDailyPrice: 80 }),
    ).toEqual(["$20–$80/day"]);
  });

  it("describes a location filter with and without a radius", () => {
    expect(
      describeSavedSearchFilters({ latitude: 1, longitude: 2, radiusKm: 5 }),
    ).toEqual(["within 5km"]);
    expect(describeSavedSearchFilters({ latitude: 1, longitude: 2 })).toEqual([
      "near a location",
    ]);
  });

  it("returns nothing for a search with no filters", () => {
    expect(describeSavedSearchFilters({})).toEqual([]);
  });
});
