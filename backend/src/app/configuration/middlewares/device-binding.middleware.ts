import type { RequestHandler } from "express";
import {
  createDeviceBindingId,
  readDeviceBinding,
  writeDeviceBindingCookie,
} from "@/features/auth/device/device-binding";

/**
 * Attaches the device binding the request presented, once its signature
 * checks out. Runs after `clientContextMiddleware`. `x-device-id` stays on
 * `request.client.device.id` as a hint: it labels the device but never makes
 * it known. See docs/auth-security.md#device-binding.
 */
export const deviceBindingMiddleware: RequestHandler = (
  request,
  _response,
  next,
) => {
  const binding = readDeviceBinding(request);

  if (binding) {
    request.client.deviceBinding = binding;
  }

  next();
};

/**
 * Mounted on `/auth`: a request without a valid device cookie is handed a new
 * one, so the browser holds it before the sign-in it later verifies. The new
 * id is not attached to this request, since nothing yet proves the client
 * keeps cookies; it counts from the next request that presents it.
 */
export const deviceBindingIssueMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  if (!request.client.deviceBinding) {
    writeDeviceBindingCookie(response, createDeviceBindingId());
  }

  next();
};
