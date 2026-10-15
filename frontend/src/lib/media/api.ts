import { authenticatedJson } from "@/lib/api/client";
import { getClientAppHeader } from "@/lib/api/client-app";
import { readStoredSession } from "@/lib/auth/storage";
import { resolveUploadContentType } from "@/lib/blob/image-policy";
import { resolveApiBaseUrl } from "@/lib/env";
import {
  mediaStatusChannel,
  type MediaStatusChannel,
} from "@/lib/media/status-socket";

/**
 * What an upload is for, mirroring the backend's closed set. Each attach
 * target accepts only images uploaded for it: posting photos `postings`,
 * organization logos and blog covers `organizations`, avatars `avatars`.
 */
export const MEDIA_SCOPES = ["postings", "organizations", "avatars"] as const;

export type MediaScope = (typeof MEDIA_SCOPES)[number];

export type MediaStatus =
  | "pending_upload"
  | "uploaded"
  | "processing"
  | "ready"
  | "rejected";

/**
 * Why the API rejected an image, for branching or localizing without parsing
 * `rejectionReason`. More codes may be added; treat an unknown one like
 * `corrupt`. `processing_failed` is not the image's fault. `malware` means the
 * malware scan flagged the file, and `moderation` that content moderation found
 * the image harmful; in both cases the reason deliberately says no more.
 * `unscreenable` means moderation could not analyze the image at all.
 * `unattached` means nothing saved the image in time and it was deleted.
 */
export type MediaRejectionCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "type_mismatch"
  | "dimensions"
  | "corrupt"
  | "animated"
  | "upload_changed"
  | "missing_upload"
  | "processing_failed"
  | "abandoned"
  | "malware"
  | "moderation"
  | "unscreenable"
  | "unattached";

/** One stored rendition of an image, with its real dimensions. */
export interface ImageRendition {
  url: string;
  width: number;
  height: number;
}

/**
 * The recorded renditions of a processed image: a thumbnail 300 px wide, a
 * medium 800 px wide, and the processed image itself. One the image was too
 * narrow for is given as the large rendition. Feed them to ResponsiveImage. A
 * field holding them is null (or absent, in a response cached before they
 * were exposed) until the image's renditions are recorded.
 */
export interface ImageVariants {
  thumbnail: ImageRendition;
  medium: ImageRendition;
  large: ImageRendition;
}

/**
 * An uploaded image as the API reports it. `url` is only set once the image is
 * `ready`, and then always points at the processed copy: the bytes a client
 * uploads sit in quarantine and are never addressable.
 */
export interface MediaView {
  id: string;
  status: MediaStatus;
  scope: string;
  url: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  /** Set with `url` once the image's renditions are recorded. */
  variants: ImageVariants | null;
  rejectionReason: string | null;
  /** Set when `status` is `rejected`; null for older rejections. */
  rejectionCode: MediaRejectionCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMediaUploadInput {
  filename: string;
  contentType: string;
  /** Declared up front so an oversized file is refused before the transfer. */
  sizeBytes?: number;
  scope: MediaScope;
}

/** A write-only credential for the quarantined upload. */
export interface MediaUploadInstructions {
  method: "PUT";
  url: string;
  expiresAt: string;
  headers: Record<string, string>;
}

/**
 * Starting an upload returns only the media id and where to PUT the bytes.
 * There is nothing to display until `get` reports the image `ready`.
 */
export interface CreatedMediaUpload {
  mediaId: string;
  upload: MediaUploadInstructions;
}

interface MediaResult {
  media: MediaView;
}

export const mediaApi = {
  createUpload(
    input: CreateMediaUploadInput,
    signal?: AbortSignal,
  ): Promise<CreatedMediaUpload> {
    return authenticatedJson<CreatedMediaUpload, CreateMediaUploadInput>(
      "POST",
      "/media/uploads",
      input,
      undefined,
      signal,
    );
  },
  async complete(mediaId: string, signal?: AbortSignal): Promise<MediaView> {
    const result = await authenticatedJson<MediaResult>(
      "POST",
      `/media/${encodeURIComponent(mediaId)}/complete`,
      undefined,
      undefined,
      signal,
    );
    return result.media;
  },
  async get(
    mediaId: string,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<MediaView> {
    const result = await authenticatedJson<MediaResult>(
      "GET",
      `/media/${encodeURIComponent(mediaId)}`,
      undefined,
      headers,
      signal,
    );
    return result.media;
  },
  async delete(mediaId: string): Promise<void> {
    await authenticatedJson<{ deleted: true }>(
      "DELETE",
      `/media/${encodeURIComponent(mediaId)}`,
    );
  },
  /** Best-effort delete that survives the page being unloaded. */
  deleteKeepalive(mediaId: string): void {
    if (typeof window === "undefined") {
      return;
    }

    const session = readStoredSession();

    if (!session?.accessToken) {
      return;
    }

    void fetch(`${resolveApiBaseUrl()}/media/${encodeURIComponent(mediaId)}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
        ...getClientAppHeader(),
        authorization: `Bearer ${session.accessToken}`,
      },
      credentials: "include",
      keepalive: true,
    });
  },
};

export interface UploadedImage {
  mediaId: string;
  /** The processed image, safe to display. */
  url: string;
  /** Its renditions, for a preview drawn smaller than the image. */
  variants: ImageVariants | null;
}

export type UploadImageStage = "uploading" | "processing";

/**
 * The server looked at the image and refused it. Unlike a dropped connection
 * or a timeout, sending the same file again will not help.
 */
export class MediaRejectedError extends Error {
  readonly mediaId: string;
  readonly code: MediaRejectionCode | null;

  constructor(
    message: string,
    mediaId: string,
    code: MediaRejectionCode | null,
  ) {
    super(message);
    this.name = "MediaRejectedError";
    this.mediaId = mediaId;
    this.code = code;
  }
}

export interface UploadImageOptions {
  scope: MediaScope;
  /** Reports when the transfer ends and server-side processing begins. */
  onStageChange?: (stage: UploadImageStage) => void;
  /**
   * Reports the media id as soon as the upload exists, so a caller that
   * cancels later can still delete it.
   */
  onCreated?: (mediaId: string) => void;
  /** Cancels the transfer and stops polling; the promise rejects with it. */
  signal?: AbortSignal;
  /**
   * Delays between status checks while no status push can arrive, in order;
   * the last one repeats.
   */
  pollDelaysMs?: number[];
  /** Where status pushes come from; the page's shared socket by default. */
  statusChannel?: MediaStatusChannel;
  /** How long to wait for processing before giving up. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_POLL_DELAYS_MS = [500, 750, 1000, 1500, 2000];
/**
 * Delays between checks while the status socket is listening. A push ends the
 * wait as soon as the item finishes, so these only cover a push that is lost,
 * as when the worker cannot reach Redis. Kept close to the polling schedule,
 * so a lost push costs about a second more than polling would have.
 */
const PUSH_FALLBACK_DELAYS_MS = [1000, 2000, 3000];
/** What `uploadImage` measured, for the server's latency metrics. */
const UPLOAD_TIMING_HEADER = "x-media-upload-timing";
const DEFAULT_PROCESSING_TIMEOUT_MS = 60_000;

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The upload was cancelled.", "AbortError")
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function waitFor(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortReason(signal));
      },
      { once: true },
    );
  });
}

/**
 * Uploads an image and waits until the server has validated and processed it.
 *
 * The server is the only judge of what is acceptable: an unsupported type or
 * size is refused when the upload is created, and bytes that are not really an
 * image come back as a rejected item. Either way the server's reason is thrown,
 * so the caller can show it rather than a generic "try again".
 *
 * While it waits, the media status socket says the moment the item finishes,
 * and the item is read then. Polling continues behind it, slowly while the
 * socket listens and at the full rate while it does not, so a lost push or a
 * socket that never connects only costs time.
 */
export async function uploadImage(
  file: File,
  options: UploadImageOptions,
): Promise<UploadedImage> {
  const { signal } = options;
  const channel = options.statusChannel ?? mediaStatusChannel;

  throwIfAborted(signal);
  // Taken first, so the socket connects while the file is being sent.
  const release = channel.acquire();

  try {
    return await uploadAndWait(file, options, channel);
  } finally {
    release();
  }
}

async function uploadAndWait(
  file: File,
  options: UploadImageOptions,
  channel: MediaStatusChannel,
): Promise<UploadedImage> {
  const { signal } = options;
  const sleep = options.sleep ?? ((ms: number) => waitFor(ms, signal));
  const now = options.now ?? Date.now;
  const pollDelays = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS;

  options.onStageChange?.("uploading");
  const uploadStartedAt = now();
  const { mediaId, upload } = await mediaApi.createUpload(
    {
      filename: file.name,
      contentType: resolveUploadContentType(file),
      sizeBytes: file.size,
      scope: options.scope,
    },
    signal,
  );
  options.onCreated?.(mediaId);
  throwIfAborted(signal);
  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: file,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}.`);
  }

  throwIfAborted(signal);
  options.onStageChange?.("processing");
  const uploadMs = now() - uploadStartedAt;
  // Listened for before completing, so a worker that finishes before the
  // completion's response arrives is not missed.
  const push = listenForPush(channel, mediaId);

  try {
    const waitStartedAt = now();
    let current = await mediaApi.complete(mediaId, signal);
    const startedAt = now();
    let attempt = 0;

    while (current.status !== "ready" && current.status !== "rejected") {
      if (now() - startedAt >= timeoutMs) {
        throw new Error(
          "The image is taking too long to process. Please try again.",
        );
      }

      const delays = channel.isListening()
        ? PUSH_FALLBACK_DELAYS_MS
        : pollDelays;
      const via = await push.waitWith(
        sleep(delays[Math.min(attempt, delays.length - 1)] ?? 1000),
      );
      throwIfAborted(signal);
      attempt += 1;
      // Sent with every check, since any of them may be the one that finds
      // the item finished; the server records only that one.
      current = await mediaApi.get(mediaId, signal, {
        [UPLOAD_TIMING_HEADER]: [
          `upload=${Math.round(uploadMs)}`,
          `wait=${Math.round(now() - waitStartedAt)}`,
          `via=${via}`,
        ].join(", "),
      });
    }

    return readUploadedImage(current);
  } finally {
    push.stop();
  }
}

/**
 * Pushes for one item. A push that arrives between waits, such as during the
 * completion call or a check, is kept, so the next wait ends at once.
 */
function listenForPush(channel: MediaStatusChannel, mediaId: string) {
  let pending = false;
  let wake: (() => void) | null = null;
  const unsubscribe = channel.onStatus(mediaId, () => {
    pending = true;
    wake?.();
  });

  return {
    /** Ends at whichever comes first, `sleeping` or a push, and says which. */
    async waitWith(sleeping: Promise<void>): Promise<"poll" | "push"> {
      try {
        return await Promise.race([
          sleeping.then(() => "poll" as const),
          new Promise<"push">((resolve) => {
            wake = () => resolve("push");

            if (pending) {
              wake();
            }
          }),
        ]);
      } finally {
        // A check follows either way, and it reads whatever the push was for.
        wake = null;
        pending = false;
      }
    },
    stop: unsubscribe,
  };
}

function readUploadedImage(current: MediaView): UploadedImage {
  if (current.status === "rejected") {
    throw new MediaRejectedError(
      current.rejectionReason ?? "The image could not be processed.",
      current.id,
      current.rejectionCode ?? null,
    );
  }

  if (!current.url) {
    throw new Error("The image could not be processed.");
  }

  return {
    mediaId: current.id,
    url: current.url,
    variants: current.variants ?? null,
  };
}
