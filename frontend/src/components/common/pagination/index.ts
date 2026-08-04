export {
  Pagination,
  PaginationLinks,
  type PaginationLinksProps,
  type PaginationProps,
} from "./pagination";
// Re-exported from a non-client module on purpose: server components build
// href templates from these, and a value exported from "./pagination" would
// reach them as a client reference instead of a string.
export { PAGE_SIZE_TEMPLATE_TOKEN, PAGE_TEMPLATE_TOKEN } from "./href-template";
export { getPageRange, type PageRangeItem } from "./page-range";
