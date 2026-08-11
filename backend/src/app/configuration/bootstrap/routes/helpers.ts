import type { Request, RequestHandler, Response } from "express";
import {
  getRequestContainer,
  type ServiceToken,
} from "@/configuration/bootstrap/container";

type ControllerHandler = (
  request: Request,
  response: Response,
) => Promise<void>;

export type ControllerHandlerName<TController> = {
  [TKey in keyof TController]: TController[TKey] extends ControllerHandler
    ? TKey
    : never;
}[keyof TController];

/**
 * Binds a route to a controller method, resolving the controller from the
 * request-scoped container so each request gets its own instance.
 */
export function resolveHandler<TController>(
  token: ServiceToken<TController>,
  handlerName: ControllerHandlerName<TController>,
): RequestHandler {
  return async (request: Request, response: Response): Promise<void> => {
    const controller = getRequestContainer(request).resolve(token);
    const handler = controller[handlerName] as ControllerHandler;

    await handler(request, response);
  };
}
