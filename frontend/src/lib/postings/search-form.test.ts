import { describe, expect, it } from "vitest";
import {
  buildSearchFormQuery,
  toDateTimeLocalValue,
  toUtcIsoDateTime,
} from "./search-form";

describe("search form helpers", () => {
  it("round-trips browser datetime-local values through UTC ISO strings", () => {
    const localValue = "2026-06-15T09:30";
    const isoValue = toUtcIsoDateTime(localValue);

    expect(isoValue).toBeTruthy();
    expect(toDateTimeLocalValue(isoValue ?? undefined)).toBe(localValue);
  });

  it("builds query params and normalizes dates", () => {
    const params = buildSearchFormQuery([
      ["q", "loft"],
      ["page", "1"],
      ["tags", "wifi"],
      ["tags", "desk"],
      ["startAt", "2026-06-15T09:30"],
      ["endAt", "2026-06-17T18:45"],
    ]);

    expect(params.get("q")).toBe("loft");
    expect(params.getAll("tags")).toEqual(["wifi", "desk"]);
    expect(params.get("page")).toBe("1");
    expect(params.get("startAt")).toBe(toUtcIsoDateTime("2026-06-15T09:30"));
    expect(params.get("endAt")).toBe(toUtcIsoDateTime("2026-06-17T18:45"));
  });

  it("omits empty values", () => {
    const emptyDateParams = buildSearchFormQuery([
      ["q", "   "],
      ["minDailyPrice", ""],
      ["startAt", ""],
      ["endAt", ""],
    ]);

    expect(emptyDateParams.get("q")).toBeNull();
    expect(emptyDateParams.get("minDailyPrice")).toBeNull();
    expect(emptyDateParams.get("startAt")).toBeNull();
    expect(emptyDateParams.get("endAt")).toBeNull();
  });
});
