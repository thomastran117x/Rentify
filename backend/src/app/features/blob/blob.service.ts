import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { buildApiPath } from "@/configuration/http/api-path";
import { environment } from "@/configuration/environment/index";
import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import type { Uuid } from "@/configuration/validation/uuid";
import type {
  BlobProperties,
  BlobUploadTarget,
  CreateBlobUploadUrlInput,
  ManagedBlobItem,
} from "@/features/blob/blob.model";

interface AzureBlobConfiguration {
  accountName: string;
  accountKey: string;
  serviceUrl: string;
  containerName: string;
  sasTtlSeconds: number;
}

interface LocalBlobConfiguration {
  storageRoot: string;
  uploadTtlSeconds: number;
  signingSecret: string;
  defaultPublicOrigin: string;
}

const DEFAULT_SAS_TTL_SECONDS = 15 * 60;
const SAFE_CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const LOCAL_BLOB_CONTAINER_NAME = "local-dev";
const LOCAL_BLOB_UPLOAD_PATH = buildApiPath("/blob/upload");
const LOCAL_BLOB_FILE_PATH = buildApiPath("/blob/file");
// Derived images sit one level below the original's owner directory.
const THUMBNAIL_DIRECTORY = "thumbnails";
// Client uploads land here and are never served; see MediaService.
const QUARANTINE_ROOT = "quarantine";
const QUARANTINE_IMAGE_DIRECTORY = `${QUARANTINE_ROOT}/images`;
// Validated, re-encoded images written by the media processing worker.
const PROCESSED_IMAGE_DIRECTORY = "media/images";
const PROCESSED_IMAGE_EXTENSION = ".webp";

function hasErrorCode(error: unknown, key: "code", value: string): boolean;
function hasErrorCode(
  error: unknown,
  key: "statusCode",
  value: number,
): boolean;
function hasErrorCode(
  error: unknown,
  key: "code" | "statusCode",
  value: string | number,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    key in error &&
    (error as Record<string, unknown>)[key] === value
  );
}

/**
 * Storage adapter for Azure Blob Storage, with a local-disk stand-in for
 * development. It signs upload URLs, moves bytes, and owns the blob naming
 * convention, but decides nothing about what may be stored or who may attach
 * it - that is MediaService's job.
 */
export class BlobService {
  private readonly config: AzureBlobConfiguration | null;
  private readonly localConfig: LocalBlobConfiguration | null;

  constructor() {
    this.config = this.readConfiguration();
    this.localConfig = this.readLocalConfiguration();
  }

  createUploadUrl(input: CreateBlobUploadUrlInput): BlobUploadTarget {
    const blobName = this.normalizeBlobName(input.blobName);
    const contentType = this.normalizeContentType(input.contentType);

    if (this.config) {
      return this.createAzureUploadUrl(blobName, contentType);
    }

    const localConfig = this.requireLocalConfiguration();
    const expiresAt = new Date(
      Date.now() + localConfig.uploadTtlSeconds * 1000,
    );
    const token = this.signLocalUploadToken(blobName, expiresAt.toISOString());
    const publicOrigin = this.resolvePublicOrigin(input.requestOrigin);

    return {
      method: "PUT",
      uploadUrl: this.buildLocalUploadUrl(
        publicOrigin,
        blobName,
        expiresAt.toISOString(),
        token,
      ),
      expiresAt: expiresAt.toISOString(),
      blobName,
      blobUrl: this.buildLocalBlobUrl(publicOrigin, blobName),
      container: LOCAL_BLOB_CONTAINER_NAME,
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": contentType,
      },
    };
  }

  isConfigured(): boolean {
    return this.config !== null || this.localConfig !== null;
  }

  /**
   * Verifies a signed local upload URL. Throws 501 when local storage is not
   * available, before looking at the token.
   */
  assertLocalUploadToken(
    blobName: string,
    expiresAt: string,
    token: string,
  ): void {
    this.requireLocalConfiguration();
    const expectedToken = this.signLocalUploadToken(blobName, expiresAt);
    const expectedBuffer = Buffer.from(expectedToken, "utf8");
    const providedBuffer = Buffer.from(token, "utf8");

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new BadRequestError("Blob upload token is invalid.");
    }

    const expiry = Date.parse(expiresAt);

    if (!Number.isFinite(expiry) || expiry < Date.now()) {
      throw new BadRequestError("Blob upload URL has expired.");
    }
  }

  async writeLocalBlob(
    blobName: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const { blobPath, metadataPath } = this.resolveLocalBlobPaths(blobName);

    await mkdir(path.dirname(blobPath), {
      recursive: true,
    });
    await writeFile(blobPath, body);
    await writeFile(
      metadataPath,
      JSON.stringify({
        contentType,
      }),
      "utf8",
    );
  }

  async readLocalBlob(blobName: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    this.requireLocalConfiguration();
    return this.readLocalBlobData(blobName);
  }

  async getProperties(blobName: string): Promise<BlobProperties> {
    const normalizedBlobName = this.normalizeBlobName(blobName);

    if (this.config) {
      try {
        const properties =
          await this.createBlobClient(normalizedBlobName).getProperties();

        return {
          contentType: properties.contentType,
          contentLength: properties.contentLength,
          lastModified: properties.lastModified,
        };
      } catch (error) {
        if (hasErrorCode(error, "statusCode", 404)) {
          throw new ResourceNotFoundError("Blob not found.");
        }

        throw error;
      }
    }

    const { blobPath, metadataPath } =
      this.resolveLocalBlobPaths(normalizedBlobName);

    try {
      const [stats, metadataRaw] = await Promise.all([
        stat(blobPath),
        readFile(metadataPath, "utf8"),
      ]);

      return {
        contentType: this.parseLocalContentType(metadataRaw),
        contentLength: stats.size,
        lastModified: stats.mtime,
      };
    } catch (error) {
      if (hasErrorCode(error, "code", "ENOENT")) {
        throw new ResourceNotFoundError("Blob not found.");
      }

      throw error;
    }
  }

  async deleteBlob(blobName: string): Promise<void> {
    const normalizedBlobName = this.normalizeBlobName(blobName);

    if (this.config) {
      await this.createBlobClient(normalizedBlobName).deleteIfExists();
      return;
    }

    await this.deleteLocalBlob(normalizedBlobName);
  }

  async *listAzureBlobs(): AsyncGenerator<ManagedBlobItem> {
    const containerClient = this.createContainerClient();

    for await (const blob of containerClient.listBlobsFlat()) {
      yield {
        name: blob.name,
        contentType: blob.properties.contentType,
        lastModified: blob.properties.lastModified,
        contentLength: blob.properties.contentLength,
      };
    }
  }

  async downloadBlob(blobName: string): Promise<{
    body: Buffer;
    contentType?: string;
  }> {
    if (this.config) {
      const blobClient = this.createBlobClient(blobName);

      try {
        const [body, properties] = await Promise.all([
          blobClient.downloadToBuffer(),
          blobClient.getProperties(),
        ]);

        return {
          body,
          contentType: properties.contentType ?? undefined,
        };
      } catch (error) {
        if (hasErrorCode(error, "statusCode", 404)) {
          throw new ResourceNotFoundError("Blob not found.");
        }

        throw error;
      }
    }

    const localBlob = await this.readLocalBlob(blobName);
    return {
      body: localBlob.body,
      contentType: localBlob.contentType,
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
    // Trusted server-side path: the only caller is thumbnail generation, which
    // hands us bytes sharp just encoded. The image allow-list and byte
    // validation would be re-checking output we produced ourselves, so this
    // keeps the generic content-type check.
    const contentType = this.normalizeContentType(input.contentType);

    if (this.config) {
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

    const publicOrigin = this.resolvePublicOrigin();
    await this.writeLocalBlob(input.blobName, input.body, contentType);

    return {
      blobName: input.blobName,
      blobUrl: this.buildLocalBlobUrl(publicOrigin, input.blobName),
    };
  }

  getBlobUrl(blobName: string): string {
    if (this.config) {
      return this.createBlobClient(blobName).url;
    }

    return this.buildLocalBlobUrl(this.resolvePublicOrigin(), blobName);
  }

  isManagedBlobUrl(blobUrl: string, blobName: string): boolean {
    if (!this.isConfigured()) {
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

    return `${directory === "." ? "" : `${directory}/`}${THUMBNAIL_DIRECTORY}/${baseName}.webp`;
  }

  private createAzureUploadUrl(
    blobName: string,
    contentType: string,
  ): BlobUploadTarget {
    const config = this.requireConfiguration();
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
        // Not an upload constraint. This is the SAS `rsct` field, which only
        // overrides the Content-Type returned when the blob is read with this
        // token - and this token cannot read. Azure accepts a PUT with any
        // Content-Type and any bytes, which was verified against a real
        // account, so MediaService's allow-list governs what a client may ask
        // for, not what it can store.
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

  private requireConfiguration(): AzureBlobConfiguration {
    if (!this.config) {
      throw new ServiceNotImplementedError(
        "Azure Blob Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME.",
      );
    }

    return this.config;
  }

  private requireLocalConfiguration(): LocalBlobConfiguration {
    if (!this.localConfig) {
      throw new ServiceNotImplementedError(
        "Local blob uploads are only available in development when Azure Blob Storage is not configured.",
      );
    }

    return this.localConfig;
  }

  private createBlobClient(blobName: string) {
    return this.createContainerClient().getBlockBlobClient(blobName);
  }

  private createContainerClient() {
    const config = this.requireConfiguration();
    const credential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    const serviceClient = new BlobServiceClient(config.serviceUrl, credential);
    return serviceClient.getContainerClient(config.containerName);
  }

  private readConfiguration(): AzureBlobConfiguration | null {
    const blobConfig = environment.getBlobStorageConfig();
    const connectionString = blobConfig.connectionString;
    const containerName = blobConfig.containerName;

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

  private readLocalConfiguration(): LocalBlobConfiguration | null {
    if (this.config || !environment.isDevelopment()) {
      return null;
    }

    const port = String(environment.getServerPort());
    const signingSecret = environment.getTokenConfig().accessTokenSecret;

    return {
      storageRoot: path.resolve(process.cwd(), "tmp", "blob-storage"),
      uploadTtlSeconds: DEFAULT_SAS_TTL_SECONDS,
      signingSecret,
      defaultPublicOrigin: `http://localhost:${port}`,
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
    return environment.getBlobStorageConfig().uploadSasTtlSeconds;
  }

  /**
   * Where a client uploads the bytes for a media record. The name carries no
   * extension: the declared type is on the record, and nothing is inferred from
   * the name until the bytes have been decoded.
   */
  buildQuarantineImageBlobName(ownerId: Uuid, mediaId: Uuid): string {
    return `${QUARANTINE_IMAGE_DIRECTORY}/${ownerId}/${mediaId}`;
  }

  buildProcessedImageBlobName(ownerId: Uuid, mediaId: Uuid): string {
    return `${PROCESSED_IMAGE_DIRECTORY}/${ownerId}/${mediaId}${PROCESSED_IMAGE_EXTENSION}`;
  }

  /** True for anything under quarantine/, which must never be served. */
  isQuarantineBlobName(blobName: string): boolean {
    const normalized = path.posix
      .normalize(blobName.trim())
      .replace(/^\/+/, "")
      .toLowerCase();

    return (
      normalized === QUARANTINE_ROOT ||
      normalized.startsWith(`${QUARANTINE_ROOT}/`)
    );
  }

  /** True for an image written by the media processing worker. */
  isProcessedImageBlobName(blobName: string): boolean {
    return blobName.trim().startsWith(`${PROCESSED_IMAGE_DIRECTORY}/`);
  }

  /**
   * Reads the owner segment back out of a name of the form
   * `<prefix>/<ownerId>/<file>` - quarantined and processed media, and blobs
   * stored before media existed - or of a thumbnail derived from one. Returns
   * null when the name is invalid or not in that shape. The prefix may contain
   * slashes and the file never does, so the owner is found from the end.
   */
  getBlobOwnerId(blobName: string): string | null {
    let normalizedBlobName: string;

    try {
      normalizedBlobName = this.normalizeBlobName(blobName);
    } catch {
      return null;
    }

    // A thumbnail keeps its original's owner: skip the directory it adds.
    const segments = normalizedBlobName.split("/");
    const ownerSegments =
      segments.at(-2) === THUMBNAIL_DIRECTORY
        ? segments.slice(0, -1)
        : segments;

    return ownerSegments.length < 3 ? null : (ownerSegments.at(-2) ?? null);
  }

  // Generic shape-only check. Which types may be uploaded at all is decided
  // before a name or URL is issued, by MediaService's image allow-list.
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

  private buildLocalUploadUrl(
    publicOrigin: string,
    blobName: string,
    expiresAt: string,
    token: string,
  ): string {
    const url = new URL(`${publicOrigin}${LOCAL_BLOB_UPLOAD_PATH}`);
    url.searchParams.set("blobName", blobName);
    url.searchParams.set("expiresAt", expiresAt);
    url.searchParams.set("token", token);
    return url.toString();
  }

  private buildLocalBlobUrl(publicOrigin: string, blobName: string): string {
    const url = new URL(`${publicOrigin}${LOCAL_BLOB_FILE_PATH}`);
    url.searchParams.set("blobName", blobName);
    return url.toString();
  }

  private resolvePublicOrigin(requestOrigin?: string): string {
    const localConfig = this.requireLocalConfiguration();
    const normalizedRequestOrigin = requestOrigin?.trim();

    if (!normalizedRequestOrigin) {
      return localConfig.defaultPublicOrigin;
    }

    try {
      return new URL(normalizedRequestOrigin).origin;
    } catch {
      return localConfig.defaultPublicOrigin;
    }
  }

  private signLocalUploadToken(blobName: string, expiresAt: string): string {
    const localConfig = this.requireLocalConfiguration();
    return createHmac("sha256", localConfig.signingSecret)
      .update(`${blobName}:${expiresAt}`)
      .digest("hex");
  }

  private normalizeBlobName(blobName: string): string {
    const normalized = path.posix
      .normalize(blobName.trim())
      .replace(/^\/+/, "");

    if (
      !normalized ||
      normalized.startsWith("..") ||
      normalized.includes("../")
    ) {
      throw new BadRequestError("Blob name is invalid.");
    }

    return normalized;
  }

  private async readLocalBlobData(blobName: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    const { blobPath, metadataPath } = this.resolveLocalBlobPaths(blobName);

    try {
      const [body, metadataRaw] = await Promise.all([
        readFile(blobPath),
        readFile(metadataPath, "utf8"),
      ]);

      return {
        body,
        contentType: this.parseLocalContentType(metadataRaw),
      };
    } catch (error) {
      if (hasErrorCode(error, "code", "ENOENT")) {
        throw new ResourceNotFoundError("Blob not found.");
      }

      throw error;
    }
  }

  private async deleteLocalBlob(blobName: string): Promise<void> {
    const { blobPath, metadataPath } = this.resolveLocalBlobPaths(blobName);

    const results = await Promise.allSettled([
      unlink(blobPath),
      unlink(metadataPath),
    ]);
    const unexpectedFailure = results.find(
      (result) =>
        result.status === "rejected" &&
        !hasErrorCode(result.reason, "code", "ENOENT"),
    );

    if (unexpectedFailure?.status === "rejected") {
      throw unexpectedFailure.reason;
    }
  }

  private resolveLocalBlobPaths(blobName: string): {
    blobPath: string;
    metadataPath: string;
  } {
    const localConfig = this.requireLocalConfiguration();
    const blobPath = path.join(
      localConfig.storageRoot,
      this.normalizeBlobName(blobName).replace(/\//g, path.sep),
    );

    return { blobPath, metadataPath: `${blobPath}.meta.json` };
  }

  private parseLocalContentType(metadataRaw: string): string {
    const metadata = JSON.parse(metadataRaw) as {
      contentType?: string;
    };

    return metadata.contentType &&
      SAFE_CONTENT_TYPE_PATTERN.test(metadata.contentType)
      ? metadata.contentType
      : "application/octet-stream";
  }
}
