import type { Request } from "express";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import { getRequestUrl } from "@/configuration/http/request";
import type { ContentSanitizationInput } from "@/features/security/content-sanitization.service";
import { RequestValidationError } from "./request";

const SKIPPED_REQUEST_BODY_SEGMENTS = new Set([
  "password",
  "newPassword",
  "currentPassword",
  "refreshToken",
  "accessToken",
  "idToken",
  "captchaToken",
  "codeVerifier",
  "signature",
]);

function shouldSkipBodyPath(path: string): boolean {
  if (!path) {
    return false;
  }

  return path
    .split(".")
    .some((segment) => SKIPPED_REQUEST_BODY_SEGMENTS.has(segment));
}

function collectStringInputs(
  value: unknown,
  path: string,
  inputs: ContentSanitizationInput[],
): void {
  if (typeof value === "string") {
    if (!shouldSkipBodyPath(path)) {
      inputs.push({
        path,
        value,
      });
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const nextPath = path ? `${path}.${index}` : String(index);
      collectStringInputs(entry, nextPath, inputs);
    });
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  Object.entries(value).forEach(([key, entry]) => {
    const nextPath = path ? `${path}.${key}` : key;
    collectStringInputs(entry, nextPath, inputs);
  });
}

function assertSafeInputs(
  request: Request,
  inputs: ContentSanitizationInput[],
  message: string,
): void {
  if (inputs.length === 0) {
    return;
  }

  const violations = getRequestContainer(request)
    .resolve(containerTokens.contentSanitizationService)
    .inspectRequest(inputs)
    .map((violation) => ({
      path: violation.path,
      message: violation.message,
    }));

  if (violations.length > 0) {
    throw new RequestValidationError(message, violations);
  }
}

export function assertSafeRequestBody(request: Request, body: unknown): void {
  const inputs: ContentSanitizationInput[] = [];
  collectStringInputs(body, "", inputs);
  assertSafeInputs(request, inputs, "Request body validation failed.");
}

export function assertSafeRequestQuery(request: Request): void {
  // Reads searchParams rather than getQuery(): repeated parameters each need
  // inspecting, and getQuery deliberately keeps only the first value.
  const url = getRequestUrl(request);
  const valuesByKey = new Map<string, string[]>();

  url.searchParams.forEach((value, key) => {
    const values = valuesByKey.get(key);

    if (values) {
      values.push(value);
      return;
    }

    valuesByKey.set(key, [value]);
  });

  const inputs: ContentSanitizationInput[] = [];

  valuesByKey.forEach((values, key) => {
    values.forEach((value, index) => {
      inputs.push({
        path: values.length > 1 ? `query.${key}.${index}` : `query.${key}`,
        value,
      });
    });
  });

  assertSafeInputs(request, inputs, "Request query validation failed.");
}

export function assertSafeRouteParams(request: Request): void {
  const inputs = Object.entries(request.params).map(([key, value]) => ({
    path: `params.${key}`,
    value: String(value),
  }));

  assertSafeInputs(request, inputs, "Route parameter validation failed.");
}

export function requireSafeRouteParam(request: Request, name: string): string {
  const value = request.params[name] as string | undefined;

  if (!value) {
    throw new RequestValidationError("Route parameter validation failed.", [
      {
        path: name,
        message: `Route parameter ${name} is required.`,
      },
    ]);
  }

  assertSafeInputs(
    request,
    [
      {
        path: name,
        value,
      },
    ],
    "Route parameter validation failed.",
  );

  return value;
}
