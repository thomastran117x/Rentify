/**
 * Placeholders substituted into the href templates that `PaginationLinks`
 * takes, so a server component can hand it one string instead of a callback
 * (functions cannot cross the server/client boundary).
 *
 * These deliberately live outside `pagination.tsx`: that module is
 * `"use client"`, so a server component importing a value from it receives a
 * client-reference proxy rather than the string, and building an href from it
 * produces a URL containing a thrown error instead of a page number.
 *
 * Both tokens use only unreserved characters, so `URLSearchParams.toString()`
 * emits them verbatim and they can be substituted afterwards. They are
 * namespaced because Next.js uses a bare `__PAGE__` as its own route-segment
 * marker in the RSC payload.
 */
export const PAGE_TEMPLATE_TOKEN = "__RENTIFY_PAGE__";

export const PAGE_SIZE_TEMPLATE_TOKEN = "__RENTIFY_PAGE_SIZE__";
