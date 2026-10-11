/** The header `uploadImage` sends on each status check while it waits. */
export const CLIENT_UPLOAD_TIMING_HEADER = "x-media-upload-timing";

/** How the client learned the item had finished: a status push, or a poll. */
export type MediaStatusNotice = "poll" | "push";

const NOTICES: readonly MediaStatusNotice[] = ["poll", "push"];

/**
 * Longer than any wait a client puts up with, so a larger value is a broken or
 * forged clock rather than a slow upload.
 */
export const MAX_CLIENT_TIMING_MS = 600_000;

/**
 * What the client measured, in milliseconds on its own clock: `uploadMs` from
 * asking for the upload credential to the end of the PUT, and `waitMs` from
 * completing the upload to sending this request.
 */
export interface ClientUploadTiming {
  uploadMs: number;
  waitMs: number;
  via: MediaStatusNotice;
}

/**
 * Reads `upload=<ms>, wait=<ms>, via=poll|push`. Anything else, including a
 * repeated or unknown key, is null: the timings are advisory, so a header that
 * cannot be trusted is dropped rather than refused, and never fails the
 * request carrying it.
 */
export function parseClientUploadTiming(
  header: string | undefined,
): ClientUploadTiming | null {
  if (!header || header.length > 100) {
    return null;
  }

  const fields = new Map<string, string>();

  for (const part of header.split(",")) {
    const [key, value, ...rest] = part.split("=").map((piece) => piece.trim());

    if (!key || value === undefined || rest.length > 0 || fields.has(key)) {
      return null;
    }

    fields.set(key, value);
  }

  const uploadMs = readMilliseconds(fields.get("upload"));
  const waitMs = readMilliseconds(fields.get("wait"));
  const via = fields.get("via") as MediaStatusNotice | undefined;

  if (
    fields.size !== 3 ||
    uploadMs === null ||
    waitMs === null ||
    !via ||
    !NOTICES.includes(via)
  ) {
    return null;
  }

  return { uploadMs, waitMs, via };
}

function readMilliseconds(value: string | undefined): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) {
    return null;
  }

  const milliseconds = Number(value);

  return milliseconds <= MAX_CLIENT_TIMING_MS ? milliseconds : null;
}
