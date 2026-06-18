import { ApiError } from "@/lib/api/types";

export interface ApiDebugPayload {
  status?: number;
  responseBody?: unknown;
  causeMessage?: string;
}

export function toApiDebug(error: ApiError): ApiDebugPayload {
  return {
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.details !== undefined ? { responseBody: error.details } : {}),
    ...(error.cause instanceof Error
      ? { causeMessage: error.cause.message }
      : {}),
  };
}
