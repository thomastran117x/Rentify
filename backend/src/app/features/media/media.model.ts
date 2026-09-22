import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

/**
 * What an upload is for. Each attach target accepts only images uploaded for
 * it, so an image uploaded as a posting photo cannot become an avatar.
 */
export const MEDIA_SCOPES = ["postings", "organizations", "avatars"] as const;

export type MediaScope = (typeof MEDIA_SCOPES)[number];

export const createMediaUploadRequestSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required.").max(255),
  contentType: z.string().trim().min(1, "Content type is required.").max(255),
  // Advisory: the client declares this and can lie. It buys an early, clear
  // rejection for an honestly oversized file instead of a failure part-way
  // through the upload. The authoritative check runs against the real bytes.
  sizeBytes: z.number().int().positive().optional(),
  scope: z.enum(MEDIA_SCOPES, {
    error: `Scope must be one of: ${MEDIA_SCOPES.join(", ")}.`,
  }),
});

export type CreateMediaUploadRequestBody = z.infer<
  typeof createMediaUploadRequestSchema
>;

export const MEDIA_STATUSES = [
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "rejected",
] as const;

/**
 * pending_upload: a row and an upload credential exist; no bytes yet.
 * uploaded: the client reported the upload complete and a processing job is
 *   queued.
 * processing: the worker has claimed it.
 * ready: validated and re-encoded; processedBlobName may be displayed.
 * rejected: the bytes failed validation or could not be processed.
 */
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export interface MediaRecord {
  id: Uuid;
  userId: Uuid;
  status: MediaStatus;
  scope: string;
  originalBlobName: string;
  processedBlobName: string | null;
  declaredContentType: string;
  detectedContentType: string | null;
  originalFilename: string | null;
  /**
   * The original blob's ETag when the upload was completed. The worker only
   * processes those exact bytes. Null for rows completed before it was stored.
   */
  originalEtag: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMediaRecordInput {
  id: Uuid;
  userId: Uuid;
  scope: string;
  originalBlobName: string;
  declaredContentType: string;
  originalFilename: string | null;
}

export interface MarkMediaReadyInput {
  processedBlobName: string;
  detectedContentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * What a client may see of a media record. It never carries the original
 * (quarantine) blob name, and `url` is only set once the record is ready, so a
 * quarantined upload has no displayable address anywhere in the API.
 */
export interface MediaView {
  id: Uuid;
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

/** A write-only credential for the quarantine upload. It cannot be read with. */
export interface MediaUploadInstructions {
  method: "PUT";
  url: string;
  expiresAt: string;
  headers: {
    "x-ms-blob-type": "BlockBlob";
    "Content-Type": string;
  };
}

/**
 * The response to starting an upload: the media id and where to PUT the bytes,
 * nothing else. There is no media view and no renderable URL here, because
 * nothing exists to render yet; status and, once ready, the processed image's
 * url come from GET /media/:id.
 */
export interface CreatedMediaUpload {
  mediaId: Uuid;
  upload: MediaUploadInstructions;
}

/** A processed image a feature may store a reference to. */
export interface AttachableImage {
  blobName: string;
  blobUrl: string;
}

/** The fields a request uses for one image. */
export interface ImageReferenceInput {
  /** A newly uploaded image. */
  mediaId?: Uuid;
  /** The stored image, resent unchanged, or null with blobName to clear it. */
  url?: string | null;
  blobName?: string | null;
}

export interface ImageReferenceOptions {
  /** The scope a new image must have been uploaded under. */
  scope: MediaScope;
  /** Blob names already stored for this field, which may be resent. */
  storedBlobNames: ReadonlySet<string>;
  /** The request's own field names, used in error messages. */
  fields: { mediaId: string; url: string; blobName: string };
}

export interface CreateImageUploadInput {
  userId: Uuid;
  /** Display and diagnostics only; it never contributes to the blob name. */
  filename: string;
  contentType: string;
  sizeBytes?: number;
  scope: MediaScope;
  requestOrigin?: string;
}

export interface CompleteImageUploadInput {
  blobName: string;
  expiresAt: string;
  token: string;
  contentType: string;
  body: Buffer;
}

export interface MediaProcessingJobPayload {
  jobId: string;
  mediaId: Uuid;
  attempt: number;
  occurredAt: string;
}
