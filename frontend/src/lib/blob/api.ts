import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import { getClientAppHeader } from "@/lib/api/client-app";
import { readStoredSession } from "@/lib/auth/storage";
import { resolveApiBaseUrl } from "@/lib/env";

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

interface DeleteBlobResponse {
  deleted: true;
}

export const blobApi = {
  createUploadUrl(input: CreateBlobUploadUrlInput): Promise<BlobUploadTarget> {
    return authenticatedJson<BlobUploadTarget, CreateBlobUploadUrlInput>(
      "POST",
      "/blob/upload-url",
      input,
    );
  },
  async deleteBlob(blobName: string): Promise<void> {
    await authenticatedJson<DeleteBlobResponse>(
      "DELETE",
      buildPathWithQuery("/blob", { blobName }),
    );
  },
  deleteBlobKeepalive(blobName: string): void {
    if (typeof window === "undefined") {
      return;
    }

    const session = readStoredSession();

    if (!session?.accessToken) {
      return;
    }

    void fetch(
      `${resolveApiBaseUrl()}${buildPathWithQuery("/blob", { blobName })}`,
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          ...getClientAppHeader(),
          authorization: `Bearer ${session.accessToken}`,
        },
        credentials: "include",
        keepalive: true,
      },
    );
  },
};
