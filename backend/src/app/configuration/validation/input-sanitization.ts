import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
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
  context: Context<AppBindings>,
  inputs: ContentSanitizationInput[],
  message: string,
): void {
  if (inputs.length === 0) {
    return;
  }

  const violations = getRequestContainer(context)
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

export function assertSafeRequestBody(
  context: Context<AppBindings>,
  body: unknown,
): void {
  const inputs: ContentSanitizationInput[] = [];
  collectStringInputs(body, "", inputs);
  assertSafeInputs(context, inputs, "Request body validation failed.");
}

export function assertSafeRequestQuery(context: Context<AppBindings>): void {
  const url = new URL(context.req.url);
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

  assertSafeInputs(context, inputs, "Request query validation failed.");
}

export function assertSafeRouteParams(context: Context<AppBindings>): void {
  const params = context.req.param();
  const inputs = Object.entries(params).map(([key, value]) => ({
    path: `params.${key}`,
    value,
  }));

  assertSafeInputs(context, inputs, "Route parameter validation failed.");
}

export function requireSafeRouteParam(
  context: Context<AppBindings>,
  name: string,
): string {
  const value = context.req.param(name);

  if (!value) {
    throw new RequestValidationError("Route parameter validation failed.", [
      {
        path: name,
        message: `Route parameter ${name} is required.`,
      },
    ]);
  }

  assertSafeInputs(
    context,
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
