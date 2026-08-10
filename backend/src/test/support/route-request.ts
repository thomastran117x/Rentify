/**
 * Small typed helpers for route-contract tests.
 *
 * Deliberately no shared `request(path)` wrapper: the OpenAPI operation
 * coverage checker resolves a request site's path statically and only follows
 * helpers declared in the same file. A cross-file wrapper would hide which
 * endpoint each test exercises and report those operations as uncovered, so the
 * `app.request(\`http://rent.test${buildApiPath("/x")}\`)` call stays inline at
 * the call site. These helpers cover everything around it.
 */

export interface AuthHeaderOptions {
  json?: boolean;
  extra?: Record<string, string>;
}

/** `authorization: Bearer <token>`, with JSON content type by default. */
export function bearerHeaders(
  token: string,
  options: AuthHeaderOptions = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(options.json === false ? {} : { "content-type": "application/json" }),
    ...options.extra,
  };
}

export function jsonHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "content-type": "application/json", ...extra };
}

export async function readResponseData<TData>(
  response: Response,
): Promise<TData> {
  const body = (await response.json()) as { data: TData };
  return body.data;
}

export async function readResponseError(response: Response): Promise<{
  code?: string;
  details?: Record<string, unknown>;
}> {
  const body = (await response.json()) as {
    error?: { code?: string; details?: Record<string, unknown> };
  };
  return body.error ?? {};
}
