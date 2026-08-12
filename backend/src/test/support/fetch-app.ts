import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import express from "express";

/**
 * An Express app wrapped so it can still be driven with Hono's test calling
 * convention: `app.request(url, init)` in, a WHATWG `Response` out.
 *
 * Keeping this shape matters for more than convenience. The OpenAPI operation
 * coverage gate (src/app/openapi/coverage/request-sites.ts) statically parses
 * `app.request(url, { method })` call sites out of the integration suites, and
 * runs in enforce mode with failOnUnresolvedSites. Rewriting the suites to a
 * different calling convention would silently break that gate.
 *
 * Note this is a standalone object rather than something merged onto the
 * Express app: `app.request` is already taken by Express, which uses it to hold
 * the prototype for incoming request objects.
 */
export interface FetchApp {
  request(input: string, init?: RequestInit): Promise<Response>;
}

export interface TestApp extends FetchApp {
  /** The underlying Express app, for assertions about its composition. */
  instance: Express;
}

/**
 * Requests go over a real loopback socket rather than through mocked req/res
 * objects, so that everything the middleware depends on — header casing,
 * Content-Length handling, the finish and close events the response-lifecycle
 * helper hangs off — behaves exactly as it does in production.
 *
 * One server is started per app and reused for every request. Starting a fresh
 * one per request forced the client to open a new connection each time, which
 * left undici holding a keep-alive pool per port and made suites that issue
 * many requests (the rate limiter's, for one) take minutes. The server is
 * unref'd so it never keeps the Jest worker alive.
 */
function createServerHandle(app: Express) {
  let started: Promise<{ origin: string; server: Server }> | undefined;
  let responseSettled = Promise.resolve();

  const start = async () => {
    const server = createServer((request, response) => {
      responseSettled = new Promise<void>((resolve) => {
        response.on("finish", () => {
          resolve();
        });
        response.on("close", () => {
          resolve();
        });
      });

      (app as unknown as RequestListener)(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    server.unref();

    const { port } = server.address() as AddressInfo;
    return { origin: `http://127.0.0.1:${port}`, server };
  };

  return {
    async origin(): Promise<string> {
      started ??= start();
      return (await started).origin;
    },
    async settled(): Promise<void> {
      await responseSettled;
      // The listener above is registered before the app's own, so it resolves
      // first; yielding once lets any runAfterResponse work finish before the
      // test asserts on it.
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    },
  };
}

export function createFetchApp(app: Express): FetchApp {
  const handle = createServerHandle(app);

  return {
    async request(input: string, init?: RequestInit): Promise<Response> {
      // Tests address the app with absolute URLs such as
      // "http://rent.test/api/v1/health". Only the path and query are
      // meaningful; the host is replaced with the ephemeral one but preserved
      // as the Host header so anything reading it still sees what the test
      // intended.
      const target = new URL(input, "http://rent.test");
      const origin = await handle.origin();
      const headers = new Headers(init?.headers);

      if (!headers.has("host")) {
        headers.set("host", target.host);
      }

      const response = await fetch(
        `${origin}${target.pathname}${target.search}`,
        {
          ...init,
          headers,
          redirect: init?.redirect ?? "manual",
        },
      );

      const body = await response.arrayBuffer();

      await handle.settled();

      return new Response(body.byteLength > 0 ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}

/**
 * Builds a throwaway app around one or more middlewares, for the middleware
 * unit tests. Mirrors what those tests used to do with `new Hono<AppBindings>()`.
 */
export function createTestApp(configure: (app: Express) => void): TestApp {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("query parser", "simple");

  configure(app);

  return {
    ...createFetchApp(app),
    instance: app,
  };
}
