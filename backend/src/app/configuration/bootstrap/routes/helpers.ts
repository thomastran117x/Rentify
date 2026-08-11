import type { Request, RequestHandler, Response } from "express";
import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  asHonoContext,
  createLegacyContext,
} from "@/configuration/http/legacy-context";
import {
  getRequestContainer,
  type ServiceToken,
} from "@/configuration/bootstrap/container";

/** A controller that has moved to native Express handlers. */
type ExpressControllerHandler = (
  request: Request,
  response: Response,
) => Promise<void>;

/**
 * A controller still on the bridge, taking a Hono context and returning a
 * WHATWG Response. TEMPORARY.
 */
type LegacyControllerHandler = (
  context: Context<AppBindings>,
) => Promise<globalThis.Response>;

export type ControllerHandlerName<TController> = {
  [TKey in keyof TController]: TController[TKey] extends
    | ExpressControllerHandler
    | LegacyControllerHandler
    ? TKey
    : never;
}[keyof TController];

function isJsonLikeContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return (
    normalized.includes("application/json") || normalized.includes("+json")
  );
}

/**
 * Writes a WHATWG Response, as returned by the not-yet-converted controllers,
 * onto the Express response.
 *
 * A JSON body is only re-emitted through `res.json` — and so through the
 * output-format middleware's transcoder — when XML was actually asked for.
 * Otherwise the bytes are written verbatim, which matters for routes that
 * return a pre-rendered document: passing /openapi.json through res.json would
 * reserialise and reformat the committed spec file. This mirrors the old
 * middleware, which only parsed the body on the XML path.
 *
 * TEMPORARY: goes away with the legacy context bridge.
 */
async function writeWebResponse(
  request: Request,
  response: Response,
  webResponse: globalThis.Response,
): Promise<void> {
  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  response.status(webResponse.status);

  const wantsXml =
    request.outputFormat === "xml" &&
    isJsonLikeContentType(webResponse.headers.get("content-type"));

  if (wantsXml) {
    const text = await webResponse.text();

    try {
      response.json(JSON.parse(text));
    } catch {
      // Hono answered an unparseable JSON body with an empty one.
      response.end();
    }

    return;
  }

  const body = Buffer.from(await webResponse.arrayBuffer());

  if (body.length === 0) {
    response.end();
    return;
  }

  response.end(body);
}

/**
 * Wraps a route module's inline handler, which still expects a Hono context.
 *
 * TEMPORARY: goes away with the legacy context bridge.
 */
export function withLegacyContext(
  handler: (
    context: Context<AppBindings>,
  ) => Promise<globalThis.Response> | globalThis.Response,
): RequestHandler {
  return async (request: Request, response: Response): Promise<void> => {
    const webResponse = await handler(
      asHonoContext(createLegacyContext(request, response)),
    );

    await writeWebResponse(request, response, webResponse);
  };
}

export function resolveHandler<TController>(
  token: ServiceToken<TController>,
  handlerName: ControllerHandlerName<TController>,
): RequestHandler {
  return async (request: Request, response: Response): Promise<void> => {
    const controller = getRequestContainer(request).resolve(token);
    const handler = controller[handlerName] as
      | ExpressControllerHandler
      | LegacyControllerHandler;

    // Arity tells the two apart: a ported handler declares (request, response),
    // one still on the bridge declares a single context. TEMPORARY.
    if (handler.length >= 2) {
      await (handler as ExpressControllerHandler)(request, response);
      return;
    }

    const webResponse = await (handler as LegacyControllerHandler)(
      asHonoContext(createLegacyContext(request, response)),
    );

    await writeWebResponse(request, response, webResponse);
  };
}
