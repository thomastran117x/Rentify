const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : undefined;
}

export function appendRequestId(
  message: string,
  status: number | undefined,
  requestId: string | undefined,
): string {
  const id = normalizeRequestId(requestId);
  if (status === undefined || status < 500 || status > 599 || !id) {
    return message;
  }

  const reference = `Request ID: ${id}`;
  return message.endsWith(reference) ? message : `${message} ${reference}`;
}
