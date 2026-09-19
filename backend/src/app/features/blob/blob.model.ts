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
}

export interface ManagedBlobItem {
  name: string;
  contentType?: string;
  lastModified?: Date;
  contentLength?: number;
}
