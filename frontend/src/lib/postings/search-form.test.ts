import assert from "node:assert/strict";
const { buildSearchFormQuery, toDateTimeLocalValue, toUtcIsoDateTime } =
  await import(new URL("./search-form.ts", import.meta.url).href);

const localValue = "2026-06-15T09:30";
const isoValue = toUtcIsoDateTime(localValue);

assert.ok(
  isoValue,
  "expected a UTC ISO value for a valid datetime-local input",
);
assert.equal(
  toDateTimeLocalValue(isoValue),
  localValue,
  "expected ISO query params to rehydrate into browser-local datetime-local values",
);

const params = buildSearchFormQuery([
  ["q", "loft"],
  ["page", "1"],
  ["tags", "wifi"],
  ["tags", "desk"],
  ["startAt", "2026-06-15T09:30"],
  ["endAt", "2026-06-17T18:45"],
]);

assert.equal(params.get("q"), "loft");
assert.deepEqual(params.getAll("tags"), ["wifi", "desk"]);
assert.equal(params.get("page"), "1");
assert.equal(params.get("startAt"), toUtcIsoDateTime("2026-06-15T09:30"));
assert.equal(params.get("endAt"), toUtcIsoDateTime("2026-06-17T18:45"));

const emptyDateParams = buildSearchFormQuery([
  ["q", "   "],
  ["minDailyPrice", ""],
  ["startAt", ""],
  ["endAt", ""],
]);

assert.equal(emptyDateParams.get("q"), null);
assert.equal(emptyDateParams.get("minDailyPrice"), null);
assert.equal(emptyDateParams.get("startAt"), null);
assert.equal(emptyDateParams.get("endAt"), null);
