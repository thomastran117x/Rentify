import type { Request as ExpressRequest, Response } from "express";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  getHeader,
  getQuery,
  getRequestUrl,
  readRawBody,
} from "@/configuration/http/request";

/**
 * TEMPORARY migration scaffolding. Delete once every controller takes
 * `(req, res)`.
 *
 * The HTTP layer moves to Express in one step because the middleware, the app
 * bootstrap and the server are mutually type-dependent. The 18 feature
 * controllers are not: they only touch a small slice of Hono's Context. This
 * adapter reimplements exactly that slice on top of Express so the controllers
 * can be converted afterwards, in reviewable batches, instead of being dragged
 * into the same commit.
 *
 * It implements only what the controllers actually use. Anything else is
 * deliberately absent so that a controller reaching for a wider part of the
 * Hono API fails loudly rather than silently misbehaving.
 */
export interface LegacyContext {
  req: {
    url: string;
    method: string;
    path: string;
    raw: ExpressRequest;
    header(name: string): string | undefined;
    param(): Record<string, string>;
    param(name: string): string | undefined;
    query(): Record<string, string>;
    query(name: string): string | undefined;
    json(): Promise<unknown>;
    text(): Promise<string>;
  };
  res: Response;
  expressResponse: Response;
  get<TKey extends keyof AppBindings["Variables"]>(
    key: TKey,
  ): AppBindings["Variables"][TKey];
  set<TKey extends keyof AppBindings["Variables"]>(
    key: TKey,
    value: AppBindings["Variables"][TKey],
  ): void;
  var: AppBindings["Variables"];
  header(name: string, value: string): void;
  json(body: unknown, status?: number): globalThis.Response;
}

/**
 * Either a real Express request or a controller's legacy context.
 *
 * TEMPORARY: request-reading helpers accept both while the controllers are
 * migrated, so a helper can be called from ported middleware and from a
 * not-yet-ported controller at the same time. Narrows to plain `Request` in the
 * commit that deletes this file.
 */
export type RequestLike = ExpressRequest | Context<AppBindings>;

export function toRequest(source: RequestLike): ExpressRequest {
  // A legacy context exposes the underlying request as `req.raw`; an Express
  // request has no `req` property of its own.
  const candidate = source as { req?: { raw?: ExpressRequest } };
  return candidate.req?.raw ?? (source as ExpressRequest);
}

export function createLegacyContext(
  request: ExpressRequest,
  response: Response,
): LegacyContext {
  const context: LegacyContext = {
    req: {
      get url() {
        return getRequestUrl(request).toString();
      },
      get method() {
        return request.method;
      },
      get path() {
        return request.path;
      },
      raw: request,
      header: (name: string) => getHeader(request, name),
      param: ((name?: string) =>
        name === undefined
          ? (request.params as Record<string, string>)
          : (request.params as Record<string, string>)[
              name
            ]) as LegacyContext["req"]["param"],
      query: ((name?: string) => {
        const query = getQuery(request);
        return name === undefined ? query : query[name];
      }) as LegacyContext["req"]["query"],
      json: () => Promise.resolve(request.body),
      // Prefers the captured raw bytes: the webhook controllers check
      // signatures against them, and a re-serialised body would not match.
      text: () => Promise.resolve(readRawBody(request)),
    },
    res: response,
    expressResponse: response,
    get: ((key: keyof AppBindings["Variables"]) =>
      request[key]) as LegacyContext["get"],
    set: ((key: keyof AppBindings["Variables"], value: never) => {
      request[key] = value;
    }) as LegacyContext["set"],
    get var() {
      return request as unknown as AppBindings["Variables"];
    },
    header: (name: string, value: string) => {
      response.setHeader(name, value);
    },
    // Controllers `return c.json(...)`; the returned Response is written to the
    // Express response by resolveHandler.
    json: (body: unknown, status = 200) =>
      new globalThis.Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=UTF-8" },
      }),
  };

  return context;
}

/**
 * Casts the adapter to the Hono Context the controllers are still typed
 * against. Disappears with the rest of this file.
 */
export function asHonoContext(context: LegacyContext): Context<AppBindings> {
  return context as unknown as Context<AppBindings>;
}
