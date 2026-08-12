import {
  serialize as serializeCookie,
  type SerializeOptions as CookieSerializeOptions,
} from "cookie";
import type { Request, Response } from "express";

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

export interface TestContext {
  request: Request;
  response: Response;
  recorder: MockResponse;
  /** Reads request-scoped state, replacing Hono's `c.get(name)`. */
  get(name: string): unknown;
}

/**
 * Pairs an already-built mock request with a fresh response recorder.
 */
export function toTestContext(request: Request): TestContext {
  const recorder = createMockResponse();
  (recorder.response as { req?: Request }).req = request;

  return {
    request,
    response: recorder.response,
    recorder,
    get: (name: string) =>
      (request as unknown as Record<string, unknown>)[name],
  };
}

/**
 * A mock request/response pair for testing a controller handler directly.
 */
export function createTestContext(
  options: LegacyContextOptions = {},
): TestContext {
  const body = options.body ?? {};
  const serialised = typeof body === "string" ? body : JSON.stringify(body);

  const request = createMockRequest({
    ...options,
    body,
    rawBody: options.rawBody ?? options.text ?? serialised,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(serialised)),
      ...options.headers,
    },
  });
  const recorder = createMockResponse();
  // Express exposes the request from the response; the envelope helpers read
  // the request id through it.
  (recorder.response as { req?: Request }).req = request;

  return {
    request,
    response: recorder.response,
    recorder,
    get: (name: string) =>
      (request as unknown as Record<string, unknown>)[name],
  };
}

/**
 * Calls a native `(request, response)` handler against a {@link TestContext}
 * and reports what it wrote.
 *
 * `status` and the async `json()` mirror a WHATWG Response, so assertions read
 * the same as they did when handlers returned one.
 */
export async function invoke(
  handler: (request: Request, response: Response) => Promise<void> | void,
  context: TestContext,
) {
  await handler(context.request, context.response);

  return {
    status: context.recorder.status(),
    // Typed loosely like Response.json(), so callers can read into the payload.
    json: async (): Promise<any> => context.recorder.json(),
    text: async (): Promise<string> => String(context.recorder.body() ?? ""),
    // A real Headers so assertions can keep using the case-insensitive get().
    headers: new Headers(context.recorder.headers()),
  };
}

export interface LegacyContextOptions extends MockRequestOptions {
  /** Raw body text, for handlers that verify a signature over it. */
  text?: string;
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
  const cookies: string[] = [];

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
    cookie(name: string, value: string, options: CookieSerializeOptions = {}) {
      // Serialised rather than swallowed. A handler that sets a cookie is
      // usually setting it for its *attributes* — HttpOnly, Path, SameSite —
      // and a stub recording nothing lets all of that pass untested. Express
      // takes maxAge in milliseconds and emits Max-Age in seconds; the same
      // conversion happens here so assertions see what the wire would carry.
      cookies.push(
        serializeCookie(name, value, {
          ...options,
          ...(options.maxAge === undefined
            ? {}
            : { maxAge: Math.floor(options.maxAge / 1000) }),
        }),
      );
      headers["set-cookie"] = cookies.join(", ");
      return response;
    },
    clearCookie(name: string, options: CookieSerializeOptions = {}) {
      cookies.push(serializeCookie(name, "", { ...options, maxAge: 0 }));
      headers["set-cookie"] = cookies.join(", ");
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
