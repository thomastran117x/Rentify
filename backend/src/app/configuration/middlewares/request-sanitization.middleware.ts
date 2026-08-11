import type { RequestHandler } from "express";
import { assertSafeRequestQuery } from "@/configuration/validation/input-sanitization";

export const requestSanitizationMiddleware: RequestHandler = (
  request,
  _response,
  next,
) => {
  assertSafeRequestQuery(request);
  next();
};
