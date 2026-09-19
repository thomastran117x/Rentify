import type { Uuid } from "@/configuration/validation/uuid";

export interface CreateImageUploadInput {
  userId: Uuid;
  /** Display and diagnostics only; the stored extension comes from contentType. */
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
