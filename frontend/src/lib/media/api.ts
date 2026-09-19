import { authenticatedJson } from "@/lib/api/client";
import { getClientAppHeader } from "@/lib/api/client-app";
import { readStoredSession } from "@/lib/auth/storage";
import { resolveUploadContentType } from "@/lib/blob/image-policy";
import { resolveApiBaseUrl } from "@/lib/env";

export type MediaStatus =
  | "pending_upload"
  | "uploaded"
  | "processing"
  | "ready"
  | "rejected";

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
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMediaUploadInput {
  filename: string;
  contentType: string;
  /** Declared up front so an oversized file is refused before the transfer. */
  sizeBytes?: number;
  scope?: string;
}

export interface MediaUploadInstructions {
  method: "PUT";
  uploadUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
}

export interface CreatedMediaUpload {
  media: MediaView;
  upload: MediaUploadInstructions;
}

interface MediaResult {
  media: MediaView;
}

export const mediaApi = {
  createUpload(input: CreateMediaUploadInput): Promise<CreatedMediaUpload> {
    return authenticatedJson<CreatedMediaUpload, CreateMediaUploadInput>(
      "POST",
      "/media/uploads",
      input,
    );
  },
  async complete(mediaId: string): Promise<MediaView> {
    const result = await authenticatedJson<MediaResult>(
      "POST",
      `/media/${encodeURIComponent(mediaId)}/complete`,
    );
    return result.media;
  },
  async get(mediaId: string): Promise<MediaView> {
    const result = await authenticatedJson<MediaResult>(
      "GET",
      `/media/${encodeURIComponent(mediaId)}`,
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
}

export type UploadImageStage = "uploading" | "processing";

export interface UploadImageOptions {
  scope: string;
  /** Reports when the transfer ends and server-side processing begins. */
  onStageChange?: (stage: UploadImageStage) => void;
  /** Delays between status checks, in order; the last one repeats. */
  pollDelaysMs?: number[];
  /** How long to wait for processing before giving up. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_POLL_DELAYS_MS = [500, 750, 1000, 1500, 2000];
const DEFAULT_PROCESSING_TIMEOUT_MS = 60_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads an image and waits until the server has validated and processed it.
 *
 * The server is the only judge of what is acceptable: an unsupported type or
 * size is refused when the upload is created, and bytes that are not really an
 * image come back as a rejected item. Either way the server's reason is thrown,
 * so the caller can show it rather than a generic "try again".
 */
export async function uploadImage(
  file: File,
  options: UploadImageOptions,
): Promise<UploadedImage> {
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;
  const delays = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS;

  options.onStageChange?.("uploading");
  const { media, upload } = await mediaApi.createUpload({
    filename: file.name,
    contentType: resolveUploadContentType(file),
    sizeBytes: file.size,
    scope: options.scope,
  });
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}.`);
  }

  options.onStageChange?.("processing");
  let current = await mediaApi.complete(media.id);
  const startedAt = now();
  let attempt = 0;

  while (current.status !== "ready" && current.status !== "rejected") {
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        "The image is taking too long to process. Please try again.",
      );
    }

    await sleep(delays[Math.min(attempt, delays.length - 1)] ?? 1000);
    attempt += 1;
    current = await mediaApi.get(media.id);
  }

  if (current.status === "rejected" || !current.url) {
    throw new Error(
      current.rejectionReason ?? "The image could not be processed.",
    );
  }

  return { mediaId: current.id, url: current.url };
}
