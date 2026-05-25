import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { getOptionalEnvironmentVariable } from "@/configuration/environment/index";
import BadRequestError from "@/errors/http/bad-request.error";
import InternalServerError from "@/errors/http/internal-server.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import type {
  BlobUploadTarget,
  CreateBlobUploadUrlInput,
} from "@/features/blob/blob.model";

interface AzureBlobConfiguration {
  accountName: string;
  accountKey: string;
  serviceUrl: string;
  containerName: string;
  sasTtlSeconds: number;
}

const DEFAULT_SCOPE = "general";
const DEFAULT_SAS_TTL_SECONDS = 15 * 60;
const MAX_SAS_TTL_SECONDS = 60 * 60;
const MIN_SAS_TTL_SECONDS = 60;
const SAFE_CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export class BlobService {
  private readonly config: AzureBlobConfiguration | null;

  constructor() {
    this.config = this.readConfiguration();
  }

  createUploadUrl(input: CreateBlobUploadUrlInput): BlobUploadTarget {
    const config = this.requireConfiguration();
    const contentType = this.normalizeContentType(input.contentType);
    const blobName = this.buildBlobName(
      input.userId,
      input.filename,
      input.scope,
    );
    const credential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    const serviceClient = new BlobServiceClient(config.serviceUrl, credential);
    const blobClient = serviceClient
      .getContainerClient(config.containerName)
      .getBlockBlobClient(blobName);

    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + config.sasTtlSeconds * 1000);
    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: config.containerName,
        blobName,
        permissions: BlobSASPermissions.parse("cw"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn,
        contentType,
      },
      credential,
    ).toString();

    return {
      method: "PUT",
      uploadUrl: `${blobClient.url}?${sasToken}`,
      expiresAt: expiresOn.toISOString(),
      blobName,
      blobUrl: blobClient.url,
      container: config.containerName,
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": contentType,
      },
    };
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async downloadBlob(blobName: string): Promise<{
    body: Buffer;
    contentType?: string;
  }> {
    const blobClient = this.createBlobClient(blobName);
    const [body, properties] = await Promise.all([
      blobClient.downloadToBuffer(),
      blobClient.getProperties(),
    ]);

    return {
      body,
      contentType: properties.contentType ?? undefined,
    };
  }

  async uploadBuffer(input: {
    blobName: string;
    body: Buffer;
    contentType: string;
  }): Promise<{
    blobName: string;
    blobUrl: string;
  }> {
    const contentType = this.normalizeContentType(input.contentType);
    const blobClient = this.createBlobClient(input.blobName);

    await blobClient.uploadData(input.body, {
      blobHTTPHeaders: {
        blobContentType: contentType,
      },
    });

    return {
      blobName: input.blobName,
      blobUrl: blobClient.url,
    };
  }

  getBlobUrl(blobName: string): string {
    return this.createBlobClient(blobName).url;
  }

  isManagedBlobUrl(blobUrl: string, blobName: string): boolean {
    if (!this.config) {
      return false;
    }

    return this.getBlobUrl(blobName) === blobUrl;
  }

  buildPostingPhotoThumbnailBlobName(blobName: string): string {
    const normalizedBlobName = path.posix
      .normalize(blobName.trim())
      .replace(/^\/+/, "");
    const directory = path.posix.dirname(normalizedBlobName);
    const baseName = path.posix.basename(
      normalizedBlobName,
      path.posix.extname(normalizedBlobName),
    );

    if (!baseName) {
      throw new BadRequestError("Blob name is invalid.");
    }

    return `${directory === "." ? "" : `${directory}/`}thumbnails/${baseName}.webp`;
  }

  private requireConfiguration(): AzureBlobConfiguration {
    if (!this.config) {
      throw new ServiceNotImplementedError(
        "Azure Blob Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME.",
      );
    }

    return this.config;
  }

  private createBlobClient(blobName: string) {
    const config = this.requireConfiguration();
    const credential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    const serviceClient = new BlobServiceClient(config.serviceUrl, credential);
    return serviceClient
      .getContainerClient(config.containerName)
      .getBlockBlobClient(blobName);
  }

  private readConfiguration(): AzureBlobConfiguration | null {
    const connectionString = getOptionalEnvironmentVariable(
      "AZURE_STORAGE_CONNECTION_STRING",
    );
    const containerName = getOptionalEnvironmentVariable(
      "AZURE_STORAGE_CONTAINER_NAME",
    );

    if (!connectionString && !containerName) {
      return null;
    }

    if (!connectionString || !containerName) {
      throw new ServiceNotImplementedError(
        "Azure Blob Storage requires both AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME.",
      );
    }

    const parsedConnectionString = this.parseConnectionString(connectionString);
    const sasTtlSeconds = this.readSasTtlSeconds();

    return {
      accountName: parsedConnectionString.accountName,
      accountKey: parsedConnectionString.accountKey,
      serviceUrl: parsedConnectionString.serviceUrl,
      containerName: containerName.trim(),
      sasTtlSeconds,
    };
  }

  private parseConnectionString(connectionString: string): {
    accountName: string;
    accountKey: string;
    serviceUrl: string;
  } {
    const segments = Object.fromEntries(
      connectionString
        .split(";")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => {
          const separatorIndex = segment.indexOf("=");

          if (separatorIndex <= 0) {
            throw new ServiceNotImplementedError(
              "AZURE_STORAGE_CONNECTION_STRING is invalid.",
            );
          }

          const key = segment.slice(0, separatorIndex);
          const value = segment.slice(separatorIndex + 1);
          return [key, value];
        }),
    );

    const accountName = segments.AccountName;
    const accountKey = segments.AccountKey;

    if (!accountName || !accountKey) {
      throw new ServiceNotImplementedError(
        "AZURE_STORAGE_CONNECTION_STRING must include AccountName and AccountKey for SAS generation.",
      );
    }

    const protocol = segments.DefaultEndpointsProtocol ?? "https";
    const endpointSuffix = segments.EndpointSuffix ?? "core.windows.net";
    const serviceUrl =
      segments.BlobEndpoint ??
      `${protocol}://${accountName}.blob.${endpointSuffix}`;

    return {
      accountName,
      accountKey,
      serviceUrl: serviceUrl.replace(/\/+$/, ""),
    };
  }

  private readSasTtlSeconds(): number {
    const rawValue = getOptionalEnvironmentVariable(
      "AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS",
    );

    if (!rawValue) {
      return DEFAULT_SAS_TTL_SECONDS;
    }

    const ttl = Number(rawValue);

    if (
      !Number.isInteger(ttl) ||
      ttl < MIN_SAS_TTL_SECONDS ||
      ttl > MAX_SAS_TTL_SECONDS
    ) {
      throw new ServiceNotImplementedError(
        `AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS must be an integer between ${MIN_SAS_TTL_SECONDS} and ${MAX_SAS_TTL_SECONDS}.`,
      );
    }

    return ttl;
  }

  private buildBlobName(
    userId: string,
    filename: string,
    scope?: string,
  ): string {
    const normalizedScope = this.normalizeScope(scope);
    const normalizedFilename = path.posix.basename(filename.trim());
    const extension = path.posix.extname(normalizedFilename).toLowerCase();
    const safeExtension = /^[.][a-z0-9]{1,10}$/.test(extension)
      ? extension
      : "";

    return `${normalizedScope}/${userId}/${Date.now()}-${randomUUID()}${safeExtension}`;
  }

  private normalizeScope(scope?: string): string {
    const normalizedScope = (scope ?? DEFAULT_SCOPE).trim().toLowerCase();

    if (!normalizedScope) {
      return DEFAULT_SCOPE;
    }

    if (!/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(normalizedScope)) {
      throw new BadRequestError(
        "Scope may only include lowercase letters, numbers, hyphens, and forward slashes.",
      );
    }

    return normalizedScope;
  }

  private normalizeContentType(contentType: string): string {
    const normalized = contentType.trim().toLowerCase();

    if (!normalized || !SAFE_CONTENT_TYPE_PATTERN.test(normalized)) {
      throw new BadRequestError("Content type is invalid.");
    }

    if (normalized.includes("\r") || normalized.includes("\n")) {
      throw new BadRequestError("Content type is invalid.");
    }

    return normalized;
  }
}
