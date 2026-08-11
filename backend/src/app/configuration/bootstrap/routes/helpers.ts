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

export type ControllerHandlerName<TController> = {
  // globalThis.Response, not Express's: the controllers still return a WHATWG
  // Response until the legacy context bridge is removed.
  [TKey in keyof TController]: TController[TKey] extends (
    context: Context<AppBindings>,
  ) => Promise<globalThis.Response>
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
    const handler = controller[handlerName] as (
      context: Context<AppBindings>,
    ) => Promise<globalThis.Response>;

    const webResponse = await handler(
      asHonoContext(createLegacyContext(request, response)),
    );

    await writeWebResponse(request, response, webResponse);
  };
}
