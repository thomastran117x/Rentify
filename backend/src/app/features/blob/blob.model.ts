import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

const blobScopePattern = /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/;

export const createBlobUploadUrlRequestSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required.").max(255),
  contentType: z.string().trim().min(1, "Content type is required.").max(255),
  scope: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      blobScopePattern,
      "Scope may only include lowercase letters, numbers, hyphens, and forward slashes.",
    )
    .optional(),
});

export type CreateBlobUploadUrlRequestBody = z.infer<
  typeof createBlobUploadUrlRequestSchema
>;

export const deleteBlobRequestQuerySchema = z.object({
  blobName: z.string().trim().min(1, "Blob name is required.").max(1000),
});

export type DeleteBlobRequestQuery = z.infer<
  typeof deleteBlobRequestQuerySchema
>;

export interface CreateBlobUploadUrlInput {
  userId: Uuid;
  filename: string;
  contentType: string;
  scope?: string;
  requestOrigin?: string;
}

export interface BlobUploadTarget {
  method: "PUT";
  uploadUrl: string;
  expiresAt: string;
  blobName: string;
  blobUrl: string;
  container: string;
  headers: {
    "x-ms-blob-type": "BlockBlob";
    "Content-Type": string;
  };
}
