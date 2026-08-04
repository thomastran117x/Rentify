import { describe, expect, it } from "vitest";
import { getPageRange, type PageRangeItem } from "./page-range";

describe("getPageRange", () => {
  it.each<[string, number, number, PageRangeItem[]]>([
    ["shows every page when the total fits", 1, 5, [1, 2, 3, 4, 5]],
    ["shows every page from the middle", 3, 5, [1, 2, 3, 4, 5]],
    ["shows every page at the slot limit", 4, 7, [1, 2, 3, 4, 5, 6, 7]],
    [
      "truncates both sides one page past the limit",
      4,
      8,
      [1, "ellipsis", 3, 4, 5, "ellipsis", 8],
    ],
    [
      "anchors to the left edge on page 1",
      1,
      42,
      [1, 2, 3, 4, 5, "ellipsis", 42],
    ],
    [
      "anchors to the left edge on page 2",
      2,
      42,
      [1, 2, 3, 4, 5, "ellipsis", 42],
    ],
    [
      "anchors to the left edge on page 3",
      3,
      42,
      [1, 2, 3, 4, 5, "ellipsis", 42],
    ],
    [
      "truncates both sides on page 4",
      4,
      42,
      [1, "ellipsis", 3, 4, 5, "ellipsis", 42],
    ],
    [
      "truncates both sides in the middle",
      7,
      42,
      [1, "ellipsis", 6, 7, 8, "ellipsis", 42],
    ],
    [
      "anchors to the right edge near the end",
      40,
      42,
      [1, "ellipsis", 38, 39, 40, 41, 42],
    ],
    [
      "anchors to the right edge on the last page",
      42,
      42,
      [1, "ellipsis", 38, 39, 40, 41, 42],
    ],
  ])("%s", (_label, page, totalPages, expected) => {
    expect(getPageRange(page, totalPages)).toEqual(expected);
  });

  it("widens the window with a larger sibling count", () => {
    expect(getPageRange(7, 42, 2)).toEqual([
      1,
      "ellipsis",
      5,
      6,
      7,
      8,
      9,
      "ellipsis",
      42,
    ]);
  });

  it("returns a single page when the result set is empty", () => {
    expect(getPageRange(1, 0)).toEqual([1]);
  });

  it("clamps a page beyond the last page", () => {
    expect(getPageRange(99, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("clamps a page below the first page", () => {
    expect(getPageRange(-3, 42)).toEqual([1, 2, 3, 4, 5, "ellipsis", 42]);
  });

  it("treats a zero sibling count as the narrowest window", () => {
    expect(getPageRange(7, 42, 0)).toEqual([1, "ellipsis", 7, "ellipsis", 42]);
  });
});
