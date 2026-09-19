import type { Uuid } from "@/configuration/validation/uuid";

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

export interface MediaUploadInstructions {
  method: "PUT";
  uploadUrl: string;
  expiresAt: string;
  headers: {
    "x-ms-blob-type": "BlockBlob";
    "Content-Type": string;
  };
}

export interface CreatedMediaUpload {
  media: MediaView;
  upload: MediaUploadInstructions;
}

/** A processed image a feature may store a reference to. */
export interface AttachableImage {
  blobName: string;
  blobUrl: string;
}

export interface CreateImageUploadInput {
  userId: Uuid;
  /** Display and diagnostics only; it never contributes to the blob name. */
  filename: string;
  contentType: string;
  sizeBytes?: number;
  scope?: string;
  requestOrigin?: string;
}

export interface MediaItem {
  blobName: string;
  blobUrl: string;
  /** Read from the blob name; null when it has no owner segment. */
  ownerId: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  lastModified: Date | null;
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
