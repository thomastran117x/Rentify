import BadRequestError from "@/errors/http/bad-request.error";
import type { Request } from "express";
import { ZodError, type ZodType, type output } from "zod";
import { assertSafeRequestBody } from "./input-sanitization";

export class RequestValidationError extends BadRequestError {
  constructor(
    message: string,
    public readonly details: Array<{
      path: string;
      message: string;
    }>,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

/**
 * Whether the request actually carried a body.
 *
 * `express.json()` leaves `req.body` as `{}` when nothing was sent, which is
 * indistinguishable from an explicit `{}`. Hono's `c.req.json()` threw on an
 * empty body, so this restores that distinction. Mirrors the check in
 * request-body-policy.middleware.
 */
function hasRequestBody(request: Request): boolean {
  const contentLength = request.headers["content-length"];

  if (contentLength !== undefined) {
    return Number(contentLength) > 0;
  }

  return request.headers["transfer-encoding"] !== undefined;
}

function readJsonBody(request: Request): unknown {
  if (!hasRequestBody(request)) {
    // Surfaces through handleParseError as "Request body must be valid JSON.",
    // which is what Hono produced for this case.
    throw new SyntaxError("Request body is empty.");
  }

  return request.body;
}

export async function parseRequestBody<TSchema extends ZodType>(
  request: Request,
  schema: TSchema,
): Promise<output<TSchema>> {
  try {
    const body = readJsonBody(request);
    assertSafeRequestBody(request, body);
    return schema.parse(body);
  } catch (error) {
    return handleParseError(error);
  }
}

/**
 * Variant of {@link parseRequestBody} for endpoints that accept sanitized
 * rich-text HTML in specific top-level fields (e.g. a blog post `body`). The
 * global request-body inspector rejects any HTML, so the named rich-text fields
 * are excluded from that inspection here; they must be sanitized downstream with
 * the allowlist sanitizer before persistence. All other fields are still
 * inspected for unsafe markup and injection patterns.
 */
export async function parseRequestBodyWithRichText<TSchema extends ZodType>(
  request: Request,
  schema: TSchema,
  richTextFields: readonly string[],
): Promise<output<TSchema>> {
  try {
    const body = readJsonBody(request);

    if (body && typeof body === "object" && !Array.isArray(body)) {
      const inspectable: Record<string, unknown> = { ...body };
      for (const field of richTextFields) {
        delete inspectable[field];
      }
      assertSafeRequestBody(request, inspectable);
    } else {
      assertSafeRequestBody(request, body);
    }

    return schema.parse(body);
  } catch (error) {
    return handleParseError(error);
  }
}

function handleParseError(error: unknown): never {
  if (error instanceof ZodError) {
    throw new RequestValidationError(
      "Request body validation failed.",
      error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  if (error instanceof SyntaxError) {
    throw new RequestValidationError("Request body must be valid JSON.", []);
  }

  throw error;
}
