export type PageRangeItem = number | "ellipsis";

/**
 * The page numbers to render in a pagination control, with "ellipsis" markers
 * standing in for the gaps.
 *
 * The first and last page are always present, along with `siblingCount` pages
 * either side of `page`. Inputs are clamped, so an out-of-range `page` or a
 * `totalPages` of 0 (an empty result set) still returns something renderable.
 *
 * Ellipsis entries repeat, so callers must key them by index rather than value.
 */
export function getPageRange(
  page: number,
  totalPages: number,
  siblingCount = 1,
): PageRangeItem[] {
  const lastPage = Math.max(Math.trunc(totalPages) || 1, 1);
  const current = Math.min(Math.max(Math.trunc(page) || 1, 1), lastPage);
  const siblings = Math.max(Math.trunc(siblingCount) || 0, 0);

  // First + last + current + both sibling groups + both ellipsis slots. Below
  // this many pages there is nothing to truncate, so every page is shown.
  const maxSlots = siblings * 2 + 5;

  if (lastPage <= maxSlots) {
    return range(1, lastPage);
  }

  const leftSibling = Math.max(current - siblings, 1);
  const rightSibling = Math.min(current + siblings, lastPage);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < lastPage - 1;

  // How many pages to show at whichever edge the current page is anchored to.
  const edgeCount = siblings * 2 + 3;

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, edgeCount), "ellipsis", lastPage];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, "ellipsis", ...range(lastPage - edgeCount + 1, lastPage)];
  }

  return [
    1,
    "ellipsis",
    ...range(leftSibling, rightSibling),
    "ellipsis",
    lastPage,
  ];
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
