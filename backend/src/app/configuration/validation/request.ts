import BadRequestError from "@/errors/http/bad-request.error";
import type { Context } from "hono";
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

export async function parseRequestBody<TSchema extends ZodType>(
  context: Context,
  schema: TSchema,
): Promise<output<TSchema>> {
  try {
    const body = await context.req.json();
    assertSafeRequestBody(context, body);
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
  context: Context,
  schema: TSchema,
  richTextFields: readonly string[],
): Promise<output<TSchema>> {
  try {
    const body = await context.req.json();

    if (body && typeof body === "object" && !Array.isArray(body)) {
      const inspectable: Record<string, unknown> = { ...body };
      for (const field of richTextFields) {
        delete inspectable[field];
      }
      assertSafeRequestBody(context, inspectable);
    } else {
      assertSafeRequestBody(context, body);
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
