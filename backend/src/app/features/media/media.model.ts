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

export interface CompleteImageUploadInput {
  blobName: string;
  expiresAt: string;
  token: string;
  contentType: string;
  body: Buffer;
}
