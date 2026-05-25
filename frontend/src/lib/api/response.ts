import {
  ApiError,
  type ApiErrorResponse,
  type ApiResponse,
} from "@/lib/auth/types";

export async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

export function unwrapApiResponse<TData>(payload: unknown): TData {
  const response = payload as ApiResponse<TData> | null;

  if (
    !response ||
    typeof response !== "object" ||
    response.success !== true ||
    !("data" in response)
  ) {
    throw new Error("API response payload did not include a data envelope.");
  }

  return response.data;
}

export function toApiError(response: Response, payload: unknown): ApiError {
  const errorPayload = (payload ?? null) as Partial<ApiErrorResponse> | null;
  const message = errorPayload?.message ?? "Something went wrong.";
  const code = errorPayload?.error?.code ?? "UNKNOWN_ERROR";

  return new ApiError(
    message,
    code,
    response.status,
    errorPayload?.error?.details,
  );
}
