import { parseCookie as parseCookieHeader } from "cookie";
import type {
  CookieOptions as ExpressCookieOptions,
  Request,
  Response,
} from "express";

const FALLBACK_HOST = "localhost";

type SameSite = "Strict" | "Lax" | "None";

/**
 * Options accepted by {@link writeCookie} and {@link clearCookie}.
 *
 * `maxAge` is expressed in **seconds**, matching the `hono/cookie` API this
 * replaces. Express's `res.cookie` takes milliseconds, so the helpers convert.
 * Getting this wrong silently shortens every session by a factor of 1000.
 */
export interface CookieOptions {
  domain?: string;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: SameSite;
  secure?: boolean;
}

/**
 * The absolute request URL.
 *
 * Hono exposed `c.req.url` as an absolute URL; Express only carries the path
 * and query, so callers that want `searchParams` have to rebuild it. Uses
 * `originalUrl` rather than `url` so the value is correct inside a mounted
 * router.
 */
export function getRequestUrl(request: Request): URL {
  const host = request.get("host") ?? FALLBACK_HOST;

  try {
    return new URL(request.originalUrl, `${request.protocol}://${host}`);
  } catch {
    // A malformed Host header must not take the request down; fall back to a
    // syntactically valid origin so downstream parsing still works.
    try {
      return new URL(
        request.originalUrl,
        `${request.protocol}://${FALLBACK_HOST}`,
      );
    } catch {
      return new URL(`${request.protocol}://${FALLBACK_HOST}/`);
    }
  }
}

/**
 * The full request pathname, including any mount prefix.
 *
 * Express's `req.path` is relative to the router the handler is mounted on, so
 * it drops the `/api/v1` prefix that `stripApiRoutePrefix` expects to find.
 */
export function getPathname(request: Request): string {
  const [pathname] = request.originalUrl.split("?");
  return pathname || "/";
}

/**
 * Query parameters flattened to a single value per key.
 *
 * Express yields `string[]` for repeated keys where Hono's `c.req.query()`
 * returned only the first value. Callers that need every value should read
 * `getRequestUrl(request).searchParams` instead.
 */
export function getQuery(request: Request): Record<string, string> {
  const query: Record<string, string> = {};

  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === "string") {
      query[key] = value;
      continue;
    }

    if (Array.isArray(value) && typeof value[0] === "string") {
      query[key] = value[0];
    }
  }

  return query;
}

/**
 * A single request header value, matching Hono's `c.req.header(name)`.
 */
export function getHeader(request: Request, name: string): string | undefined {
  const value = request.get(name);
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The request body exactly as it arrived on the wire.
 *
 * Signature-verifying webhooks must hash the original bytes; a body
 * re-serialised from `req.body` would differ in key order and whitespace. The
 * raw buffer is captured by express.json's verify hook in createApplication.
 */
export function readRawBody(request: Request): string {
  if (request.rawBody) {
    return request.rawBody.toString("utf8");
  }

  if (typeof request.body === "string") {
    return request.body;
  }

  if (Buffer.isBuffer(request.body)) {
    return request.body.toString("utf8");
  }

  return request.body === undefined ? "" : JSON.stringify(request.body);
}

/**
 * Reads a cookie straight off the request header.
 *
 * Deliberately independent of any cookie-parsing middleware so it cannot break
 * depending on where it sits in the chain.
 */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;

  if (!header) {
    return undefined;
  }

  return parseCookieHeader(header)[name];
}

/**
 * Sets a cookie, converting `maxAge` from seconds to the milliseconds Express
 * expects. See {@link CookieOptions}.
 */
export function writeCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  const { maxAge, ...rest } = options;

  response.cookie(name, value, {
    ...toExpressCookieOptions(rest),
    ...(maxAge === undefined ? {} : { maxAge: maxAge * 1000 }),
  });
}

/**
 * Expires a cookie. The options must match those it was written with, or the
 * browser will not treat it as the same cookie.
 */
export function clearCookie(
  response: Response,
  name: string,
  options: Omit<CookieOptions, "maxAge"> = {},
): void {
  response.clearCookie(name, toExpressCookieOptions(options));
}

/**
 * Express types `sameSite` in lower case where `hono/cookie` used the
 * capitalised spelling. The serialised header is identical either way, so we
 * normalise here and leave the capitalised spelling at the call sites.
 */
function toExpressCookieOptions(
  options: Omit<CookieOptions, "maxAge">,
): Omit<ExpressCookieOptions, "maxAge"> {
  const { sameSite, ...rest } = options;

  return {
    ...rest,
    ...(sameSite === undefined
      ? {}
      : { sameSite: sameSite.toLowerCase() as Lowercase<SameSite> }),
  };
}
