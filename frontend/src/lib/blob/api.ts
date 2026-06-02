import { authenticatedJson } from "@/lib/api/client";

export interface CreateBlobUploadUrlInput {
  filename: string;
  contentType: string;
  scope?: string;
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

export const blobApi = {
  createUploadUrl(input: CreateBlobUploadUrlInput): Promise<BlobUploadTarget> {
    return authenticatedJson<BlobUploadTarget, CreateBlobUploadUrlInput>(
      "POST",
      "/blob/upload-url",
      input,
    );
  },
};
