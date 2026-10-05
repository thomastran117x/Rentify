export interface CreateBlobUploadUrlInput {
  blobName: string;
  contentType: string;
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

export interface BlobProperties {
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  /** Changes whenever the blob is written, even with identical bytes. */
  etag?: string;
}

/**
 * Which container a blob lives in. Client uploads (quarantine/...) go to a
 * private container of their own; everything the backend writes or serves goes
 * to the public one.
 */
export type BlobContainer = "quarantine" | "public";

export interface ManagedBlobItem {
  name: string;
  container: BlobContainer;
  contentType?: string;
  lastModified?: Date;
  contentLength?: number;
}
