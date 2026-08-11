import type { Request, Response } from "express";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  asHonoContext,
  createLegacyContext,
} from "@/configuration/http/legacy-context";

export interface MockRequestOptions {
  method?: string;
  /** Absolute or path-only; only the path and query are used. */
  url?: string;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  /** Request-scoped state that middleware would normally have populated. */
  state?: Partial<Record<string, unknown>>;
}

/**
 * A minimal stand-in for an Express request, for unit tests that call a handler
 * or helper directly instead of going over HTTP.
 *
 * Only the surface the app actually reads is implemented: anything else being
 * absent is deliberate, so a new dependency shows up as a loud failure.
 */
export function createMockRequest(options: MockRequestOptions = {}): Request {
  const target = new URL(options.url ?? "/", "http://rent.test");
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = value;
    }
  }

  const query: Record<string, string | string[]> = {};

  for (const key of new Set(target.searchParams.keys())) {
    const values = target.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }

  const request = {
    method: options.method ?? "GET",
    originalUrl: `${target.pathname}${target.search}`,
    url: `${target.pathname}${target.search}`,
    path: target.pathname,
    baseUrl: "",
    protocol: target.protocol.replace(":", ""),
    headers: { host: target.host, ...headers },
    params: options.params ?? {},
    query,
    body: options.body,
    rawBody:
      options.rawBody === undefined
        ? undefined
        : Buffer.from(options.rawBody, "utf8"),
    socket: { remoteAddress: "203.0.113.10" },
    get(name: string) {
      return (this as unknown as Request).headers[
        name.toLowerCase() as keyof Request["headers"]
      ];
    },
    ...options.state,
  };

  return request as unknown as Request;
}

export interface InvokedResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers: Record<string, string>;
  request: Request;
  response: Response;
}

/**
 * Calls a native `(request, response)` controller handler against mock objects
 * and reports what it wrote.
 *
 * `status` and the async `json()` mirror a WHATWG Response so assertions read
 * the same as they did when handlers returned one.
 */
export async function invokeHandler(
  handler: (request: Request, response: Response) => Promise<void> | void,
  options: MockRequestOptions = {},
): Promise<InvokedResponse> {
  const body = options.body;
  const serialised =
    body === undefined
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body);

  const request = createMockRequest({
    ...options,
    headers: {
      ...(serialised === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(serialised)),
          }),
      ...options.headers,
    },
    rawBody: options.rawBody ?? serialised,
  });
  const recorder = createMockResponse();
  // Express exposes the request from the response; the envelope helpers read
  // the request id through it.
  (recorder.response as { req?: Request }).req = request;

  await handler(request, recorder.response);

  return {
    status: recorder.status(),
    json: async () => recorder.json(),
    text: async () => String(recorder.body() ?? ""),
    headers: recorder.headers(),
    request,
    response: recorder.response,
  };
}

export interface LegacyContextOptions extends MockRequestOptions {
  /** Value returned by `context.req.text()`. Defaults to the body, serialised. */
  text?: string;
}

/**
 * A controller context backed by mock Express objects.
 *
 * TEMPORARY, alongside the legacy context bridge itself: the controllers still
 * take a Hono-shaped context, but everything underneath is now an Express
 * request, and the shared helpers they call (parseRequestBody, requireJwtAuth,
 * …) resolve that request out of the context. Building the context through the
 * real bridge keeps those two halves consistent — a hand-rolled fake diverges
 * from what the bridge actually provides. Each of these call sites goes away as
 * its controller moves to native (req, res) handlers.
 */
export function createLegacyTestContext(
  options: LegacyContextOptions = {},
): Context<AppBindings> {
  const body = options.body ?? {};

  const request = createMockRequest({
    ...options,
    body,
    rawBody:
      options.rawBody ??
      options.text ??
      (typeof body === "string" ? body : JSON.stringify(body)),
    headers: {
      // parseRequestBody treats a request with no declared length as bodyless,
      // the way Hono's c.req.json() threw on an empty body.
      "content-length": String(
        Buffer.byteLength(
          typeof body === "string" ? body : JSON.stringify(body),
        ),
      ),
      "content-type": "application/json",
      ...options.headers,
    },
  });

  return asHonoContext(
    createLegacyContext(request, createMockResponse().response),
  );
}

export interface MockResponse {
  response: Response;
  /** Status set via res.status(), defaulting to 200 as Express does. */
  status(): number;
  /** The value handed to res.json(), if any. */
  json(): unknown;
  /** The value handed to res.send()/res.end(), if any. */
  body(): unknown;
  headers(): Record<string, string>;
  ended(): boolean;
}

/**
 * A minimal stand-in for an Express response that records what a handler wrote.
 */
export function createMockResponse(): MockResponse {
  let statusCode = 200;
  let jsonBody: unknown;
  let sentBody: unknown;
  let finished = false;
  const headers: Record<string, string> = {};

  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    get headersSent() {
      return finished;
    },
    status(value: number) {
      statusCode = value;
      return response;
    },
    json(value: unknown) {
      jsonBody = value;
      finished = true;
      return response;
    },
    send(value: unknown) {
      sentBody = value;
      finished = true;
      return response;
    },
    end(value?: unknown) {
      if (value !== undefined) {
        sentBody = value;
      }

      finished = true;
      return response;
    },
    type(value: string) {
      headers["content-type"] = value;
      return response;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
    },
    vary(name: string) {
      headers.vary = headers.vary ? `${headers.vary}, ${name}` : name;
      return response;
    },
    cookie() {
      return response;
    },
    clearCookie() {
      return response;
    },
    on() {
      return response;
    },
    once() {
      return response;
    },
    removeListener() {
      return response;
    },
  } as unknown as Response;

  return {
    response,
    status: () => statusCode,
    json: () => jsonBody,
    body: () => sentBody,
    headers: () => ({ ...headers }),
    ended: () => finished,
  };
}
