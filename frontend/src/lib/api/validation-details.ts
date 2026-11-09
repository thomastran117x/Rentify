import { ApiClientError } from "./types";

/**
 * The messages a `400 VALIDATION_ERROR` lists under one request field, joined
 * into one sentence for an inline error, or null when it names none. The wire
 * shape is `details: { [field]: string[] }`.
 */
export function getValidationFieldMessage(
  error: unknown,
  field: string,
): string | null {
  if (
    !(error instanceof ApiClientError) ||
    error.code !== "VALIDATION_ERROR" ||
    typeof error.details !== "object" ||
    error.details === null
  ) {
    return null;
  }

  const messages = (error.details as Record<string, unknown>)[field];

  if (!Array.isArray(messages)) {
    return null;
  }

  const text = messages.filter(
    (message): message is string =>
      typeof message === "string" && message.length > 0,
  );

  return text.length > 0 ? text.join(" ") : null;
}
