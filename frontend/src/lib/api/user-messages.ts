import {
  ApiError,
  isApiNetworkError,
  isApiProtocolError,
  isApiServerError,
} from "@/lib/api/types";

interface SharedApiErrorMessageOptions {
  action: string;
  productName?: string;
}

interface ApiErrorMessageOptions extends SharedApiErrorMessageOptions {
  fallback: string;
  preserveClientMessage?: boolean;
  preserveUnknownErrorMessage?: boolean;
}

function readMessage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function getSharedApiErrorMessage(
  error: unknown,
  { action, productName = "Rentify" }: SharedApiErrorMessageOptions,
): string | null {
  if (isApiNetworkError(error)) {
    return `We couldn't ${action} because we couldn't reach ${productName}. Check your connection and try again.`;
  }

  if (isApiServerError(error)) {
    return `${productName} is having trouble right now, so we couldn't ${action}. Please try again in a moment.`;
  }

  if (isApiProtocolError(error)) {
    return `We ran into an unexpected response while trying to ${action}. Please try again in a moment.`;
  }

  return null;
}

export function getApiErrorMessage(
  error: unknown,
  {
    action,
    fallback,
    productName,
    preserveClientMessage = true,
    preserveUnknownErrorMessage = true,
  }: ApiErrorMessageOptions,
): string {
  const sharedMessage = getSharedApiErrorMessage(error, {
    action,
    productName,
  });

  if (sharedMessage) {
    return sharedMessage;
  }

  if (preserveClientMessage && error instanceof ApiError) {
    return readMessage(error.message) ?? fallback;
  }

  if (preserveUnknownErrorMessage && error instanceof Error) {
    return readMessage(error.message) ?? fallback;
  }

  return fallback;
}
