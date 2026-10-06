import { createHmac, timingSafeEqual } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  type BlobSASSignatureValues,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { buildApiPath } from "@/configuration/http/api-path";
import { environment } from "@/configuration/environment/index";
import type { BlobStorageAccount } from "@/configuration/environment/types";
import { LOCAL_BLOB_UPLOAD_TTL_SECONDS } from "@/configuration/environment/constants";
import { loggerFactory } from "@/configuration/logging";
import BlobChangedError from "@/errors/blob-changed.error";
import BadRequestError from "@/errors/http/bad-request.error";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import type { Uuid } from "@/configuration/validation/uuid";
import type {
  BlobContainer,
  BlobProperties,
  BlobUploadTarget,
  CreateBlobUploadUrlInput,
  ManagedBlobItem,
} from "@/features/blob/blob.model";
import {
  PROCESSED_IMAGE_DIRECTORY,
  PROCESSED_IMAGE_EXTENSION,
} from "@/features/blob/image-variant-names";

// The account as the environment layer parsed and validated it, plus the
// containers and SAS lifetime this class signs for.
type AzureBlobConfiguration = BlobStorageAccount & {
  /** The trusted container: worker output and blobs that may be served. */
  containerName: string;
  /** The private container client uploads land in. */
  quarantineContainerName: string;
  sasTtlSeconds: number;
};

interface LocalBlobConfiguration {
  /** Holds one directory per container, named like BlobContainer. */
  storageRoot: string;
  uploadTtlSeconds: number;
  signingSecret: string;
  defaultPublicOrigin: string;
}

const SAFE_CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const LOCAL_BLOB_CONTAINER_NAME = "local-dev";
const LOCAL_BLOB_UPLOAD_PATH = buildApiPath("/blob/upload");
const LOCAL_BLOB_FILE_PATH = buildApiPath("/blob/file");
// Derived images sit one level below the original's owner directory.
const THUMBNAIL_DIRECTORY = "thumbnails";
// Client uploads land here and are never served; see MediaService.
const QUARANTINE_ROOT = "quarantine";
const QUARANTINE_IMAGE_DIRECTORY = `${QUARANTINE_ROOT}/images`;
const BLOB_CONTAINERS: readonly BlobContainer[] = ["public", "quarantine"];
// SAS start times are backdated so a client clock a little behind still works.
const SAS_CLOCK_SKEW_MS = 5 * 60 * 1000;
// One user delegation key signs every upload SAS issued while it lasts. Two
// hours keeps a key in use for most of an hour even at the longest SAS TTL.
const USER_DELEGATION_KEY_LIFETIME_MS = 2 * 60 * 60 * 1000;
// A key is replaced once a new SAS would end this close to the key's expiry.
const USER_DELEGATION_KEY_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Where a blob is read or written. "legacy" is where a quarantine name was
 * stored before the container split: the public container on Azure, the flat
 * storage root locally. Only MEDIA_QUARANTINE_LEGACY_FALLBACK looks there.
 */
type StorageLocation = BlobContainer | "legacy";

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

export interface DownloadBlobOptions {
  /** Only download while the blob still has this ETag (BlobChangedError). */
  ifMatch?: string;
  /**
   * Refuse a blob larger than this (PayloadTooLargeError), without reading
   * more than one byte past it.
   */
  maxBytes?: number;
}

/**
 * Buffers a download stream, giving up as soon as it passes maxBytes. Ending
 * the iteration early destroys the stream, so the rest is never read.
 */
async function readDownloadStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number | undefined,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    receivedBytes += buffer.byteLength;

    if (maxBytes !== undefined && receivedBytes > maxBytes) {
      throw blobTooLarge(maxBytes);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function blobTooLarge(maxBytes: number): PayloadTooLargeError {
  return new PayloadTooLargeError("Blob is larger than the allowed maximum.", {
    maxBytes,
  });
}

/**
 * Storage adapter for Azure Blob Storage, with a local-disk stand-in for
 * development. It signs upload URLs, moves bytes, and owns the blob naming
 * convention, but decides nothing about what may be stored or who may attach
 * it - that is MediaService's job.
 *
 * Blobs are split across two containers by name: quarantine/... lives in a
 * private quarantine container, which is the only one an upload URL can write
 * to, and everything else lives in the public container. Callers keep passing
 * plain blob names; the container is never part of a stored name.
 *
 * Azure is reached with the process's own Microsoft Entra ID identity
 * (AZURE_STORAGE_AUTH=entra, the default), whose roles decide what this
 * process may do in each container, or with the account key
 * (connection-string), which is deprecated.
 */
export class BlobService {
  private readonly logger = loggerFactory.forClass(BlobService, "service");
  private readonly config: AzureBlobConfiguration | null;
  private readonly localConfig: LocalBlobConfiguration | null;
  private readonly quarantineLegacyFallback: boolean;
  // Built on first use and kept, so every request shares one pipeline and,
  // in entra mode, one token cache.
  private sharedKeyCredential: StorageSharedKeyCredential | null = null;
  private serviceClient: BlobServiceClient | null = null;
  private userDelegationKey: {
    expiresOn: Date;
    key: Promise<UserDelegationKey>;
  } | null = null;

  constructor() {
    this.config = this.readConfiguration();
    this.localConfig = this.readLocalConfiguration();

    if (this.config?.auth === "connection-string") {
      this.logger.warn(
        "AZURE_STORAGE_AUTH=connection-string is deprecated and will be removed. The account key it signs with can do anything to any blob; move this process to AZURE_STORAGE_AUTH=entra (see docs/backend-configuration.md).",
      );
    }
    this.quarantineLegacyFallback =
      environment.getBlobStorageConfig().quarantineLegacyFallback;
  }

  async createUploadUrl(
    input: CreateBlobUploadUrlInput,
  ): Promise<BlobUploadTarget> {
    const blobName = this.normalizeBlobName(input.blobName);
    const contentType = this.normalizeContentType(input.contentType);

    // A client may only ever write to the quarantine container, and a blob
    // there under any other name would be one the rest of this class looks for
    // in the public container.
    if (!this.isQuarantineBlobName(blobName)) {
      throw new BadRequestError("Uploads may only target quarantine blobs.");
    }

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

  /**
   * The local stand-in for an anonymous read of the public container. It only
   * looks in the public root, and a quarantine name does not exist there.
   */
  async readPublicLocalBlob(blobName: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    this.requireLocalConfiguration();

    if (this.isQuarantineBlobName(blobName)) {
      throw new ResourceNotFoundError("Blob not found.");
    }

    return this.readLocalBlobData(blobName, "public");
  }

  async getProperties(blobName: string): Promise<BlobProperties> {
    const normalizedBlobName = this.normalizeBlobName(blobName);

    return this.withLegacyFallback(normalizedBlobName, (location) =>
      this.readProperties(normalizedBlobName, location),
    );
  }

  private async readProperties(
    normalizedBlobName: string,
    location?: StorageLocation,
  ): Promise<BlobProperties> {
    if (this.config) {
      try {
        const properties = await this.createBlobClient(
          normalizedBlobName,
          location,
        ).getProperties();

        return {
          contentType: properties.contentType,
          contentLength: properties.contentLength,
          lastModified: properties.lastModified,
          etag: properties.etag,
        };
      } catch (error) {
        if (hasErrorCode(error, "statusCode", 404)) {
          throw new ResourceNotFoundError("Blob not found.");
        }

        throw error;
      }
    }

    const { blobPath, metadataPath } = this.resolveLocalBlobPaths(
      normalizedBlobName,
      location,
    );

    try {
      const [stats, metadataRaw] = await Promise.all([
        stat(blobPath),
        readFile(metadataPath, "utf8"),
      ]);

      return {
        contentType: this.parseLocalContentType(metadataRaw),
        contentLength: stats.size,
        lastModified: stats.mtime,
        etag: this.localEtag(stats),
      };
    } catch (error) {
      if (hasErrorCode(error, "code", "ENOENT")) {
        throw new ResourceNotFoundError("Blob not found.");
      }

      throw error;
    }
  }

  /**
   * Deletes a blob from the container its name routes to, and from its legacy
   * location while the fallback is on, so an upload made before the split is
   * cleaned up like any other. Only blob-cleanup names the container, to
   * remove what it found somewhere else.
   */
  async deleteBlob(blobName: string, container?: BlobContainer): Promise<void> {
    const normalizedBlobName = this.normalizeBlobName(blobName);

    await this.deleteBlobAt(normalizedBlobName, container);

    if (!container && this.usesLegacyFallback(normalizedBlobName)) {
      await this.deleteBlobAt(normalizedBlobName, "legacy");
    }
  }

  private async deleteBlobAt(
    normalizedBlobName: string,
    location?: StorageLocation,
  ): Promise<void> {
    if (this.config) {
      await this.createBlobClient(
        normalizedBlobName,
        location,
      ).deleteIfExists();
      return;
    }

    await this.deleteLocalBlob(normalizedBlobName, location);
  }

  /** Every blob in both containers, each tagged with where it was found. */
  async *listAzureBlobs(): AsyncGenerator<ManagedBlobItem> {
    for (const container of BLOB_CONTAINERS) {
      const containerClient = this.createContainerClient(container);

      for await (const blob of containerClient.listBlobsFlat()) {
        yield {
          name: blob.name,
          container,
          contentType: blob.properties.contentType,
          lastModified: blob.properties.lastModified,
          contentLength: blob.properties.contentLength,
        };
      }
    }
  }

  /**
   * Reads a whole blob into memory. With maxBytes, a single ranged GET asks for
   * at most one byte more than the limit, so an oversized blob costs at most
   * that much to refuse. With ifMatch, the read is made conditional on the ETag
   * so what arrives is the blob the caller already checked.
   */
  async downloadBlob(
    blobName: string,
    options: DownloadBlobOptions = {},
  ): Promise<{
    body: Buffer;
    contentType?: string;
  }> {
    const normalizedBlobName = this.normalizeBlobName(blobName);

    // Both reads of a fallback blob - the properties MediaService recorded
    // and this download - land on the same legacy blob, so its ETag holds.
    return this.withLegacyFallback(normalizedBlobName, (location) =>
      this.readBlob(normalizedBlobName, options, location),
    );
  }

  private async readBlob(
    normalizedBlobName: string,
    options: DownloadBlobOptions,
    location?: StorageLocation,
  ): Promise<{
    body: Buffer;
    contentType?: string;
  }> {
    const { ifMatch, maxBytes } = options;

    if (this.config) {
      try {
        // Not downloadToBuffer: given a count it allocates that many bytes and
        // fails when the blob is shorter, so it cannot express "up to".
        const response = await this.createBlobClient(
          normalizedBlobName,
          location,
        ).download(0, maxBytes === undefined ? undefined : maxBytes + 1, {
          conditions: ifMatch ? { ifMatch } : undefined,
        });

        return {
          body: response.readableStreamBody
            ? await readDownloadStream(response.readableStreamBody, maxBytes)
            : Buffer.alloc(0),
          contentType: response.contentType ?? undefined,
        };
      } catch (error) {
        if (hasErrorCode(error, "statusCode", 404)) {
          throw new ResourceNotFoundError("Blob not found.");
        }

        if (hasErrorCode(error, "statusCode", 412)) {
          throw new BlobChangedError();
        }

        // A range starting at 0 is only unsatisfiable for an empty blob.
        if (hasErrorCode(error, "statusCode", 416)) {
          return { body: Buffer.alloc(0) };
        }

        throw error;
      }
    }

    // Checked before reading, so an oversized or replaced file is never
    // loaded. The same conditions as Azure, so both paths behave alike.
    if (ifMatch !== undefined || maxBytes !== undefined) {
      const properties = await this.readProperties(
        normalizedBlobName,
        location,
      );

      if (ifMatch !== undefined && properties.etag !== ifMatch) {
        throw new BlobChangedError();
      }

      if (
        maxBytes !== undefined &&
        (properties.contentLength ?? 0) > maxBytes
      ) {
        throw blobTooLarge(maxBytes);
      }
    }

    const localBlob = await this.readLocalBlobData(
      normalizedBlobName,
      location,
    );
    return {
      body: localBlob.body,
      contentType: localBlob.contentType,
    };
  }

  /**
   * Runs a read against the blob's container and, while
   * MEDIA_QUARANTINE_LEGACY_FALLBACK is on, retries a quarantine name that is
   * not there at its legacy location: an upload made before the split, which
   * completeMediaUpload and the media worker still have to find.
   */
  private async withLegacyFallback<T>(
    normalizedBlobName: string,
    read: (location?: StorageLocation) => Promise<T>,
  ): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (
        !(error instanceof ResourceNotFoundError) ||
        !this.usesLegacyFallback(normalizedBlobName)
      ) {
        throw error;
      }

      return read("legacy");
    }
  }

  private usesLegacyFallback(normalizedBlobName: string): boolean {
    return (
      this.quarantineLegacyFallback &&
      this.isQuarantineBlobName(normalizedBlobName)
    );
  }

  async uploadBuffer(input: {
    blobName: string;
    body: Buffer;
    contentType: string;
  }): Promise<{
    blobName: string;
    blobUrl: string;
  }> {
    // Trusted server-side path: its callers, thumbnail generation and the
    // media processing worker, hand us bytes sharp just encoded. The image
    // allow-list and byte validation would be re-checking output we produced
    // ourselves, so this keeps the generic content-type check.
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

  /**
   * The public URL of a blob. Quarantined uploads have none: refusing them
   * here backs up MediaService.isManagedUrl, so a quarantine name can never
   * turn into something stored and rendered.
   */
  getBlobUrl(blobName: string): string {
    if (this.isQuarantineBlobName(blobName)) {
      throw new BadRequestError("Quarantined blobs have no public URL.");
    }

    if (this.config) {
      return this.createBlobClient(blobName).url;
    }

    return this.buildLocalBlobUrl(this.resolvePublicOrigin(), blobName);
  }

  isManagedBlobUrl(blobUrl: string, blobName: string): boolean {
    if (!this.isConfigured() || this.isQuarantineBlobName(blobName)) {
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

  private async createAzureUploadUrl(
    blobName: string,
    contentType: string,
  ): Promise<BlobUploadTarget> {
    const config = this.requireConfiguration();
    const blobClient =
      this.createContainerClient("quarantine").getBlockBlobClient(blobName);

    const startsOn = new Date(Date.now() - SAS_CLOCK_SKEW_MS);
    const expiresOn = new Date(Date.now() + config.sasTtlSeconds * 1000);
    const sasToken = await this.signSas({
      containerName: config.quarantineContainerName,
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
    });

    return {
      method: "PUT",
      uploadUrl: `${blobClient.url}?${sasToken}`,
      expiresAt: expiresOn.toISOString(),
      blobName,
      blobUrl: blobClient.url,
      container: config.quarantineContainerName,
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": contentType,
      },
    };
  }

  /**
   * Signs with the account key, or, in entra mode, as a user delegation SAS.
   * A user delegation SAS can grant no more than the signing identity's own
   * roles allow, so the API's identity needs write access to the quarantine
   * container for a client's PUT to succeed.
   */
  private async signSas(values: BlobSASSignatureValues): Promise<string> {
    const config = this.requireConfiguration();

    if (config.auth === "connection-string") {
      return generateBlobSASQueryParameters(
        values,
        this.getSharedKeyCredential(config),
      ).toString();
    }

    const userDelegationKey = await this.getUserDelegationKey(
      values.expiresOn ?? new Date(),
    );

    return generateBlobSASQueryParameters(
      values,
      userDelegationKey,
      config.accountName,
    ).toString();
  }

  /**
   * One key signs every upload SAS until a new SAS would outlive it, so Azure
   * is asked for a key every hour or two rather than for every upload.
   * Concurrent callers share one request, and a failed request is not kept.
   */
  private getUserDelegationKey(sasExpiresOn: Date): Promise<UserDelegationKey> {
    const cached = this.userDelegationKey;

    if (
      cached &&
      cached.expiresOn.getTime() - USER_DELEGATION_KEY_REFRESH_MARGIN_MS >=
        sasExpiresOn.getTime()
    ) {
      return cached.key;
    }

    const now = Date.now();
    const expiresOn = new Date(now + USER_DELEGATION_KEY_LIFETIME_MS);
    const entry = {
      expiresOn,
      key: this.getServiceClient().getUserDelegationKey(
        new Date(now - SAS_CLOCK_SKEW_MS),
        expiresOn,
      ),
    };

    this.userDelegationKey = entry;
    entry.key.catch((error: unknown) => {
      if (this.userDelegationKey === entry) {
        this.userDelegationKey = null;
      }

      this.logger.error(
        "Could not get a user delegation key to sign upload URLs. A 403 means the API's identity lacks the Storage Blob Delegator role on the storage account.",
        {
          statusCode: (error as { statusCode?: unknown } | null)?.statusCode,
          code: (error as { code?: unknown } | null)?.code,
        },
      );
    });

    return entry.key;
  }

  private requireConfiguration(): AzureBlobConfiguration {
    if (!this.config) {
      throw new ServiceNotImplementedError(
        "Azure Blob Storage is not configured. Set AZURE_STORAGE_ACCOUNT_URL, AZURE_STORAGE_CONTAINER_NAME, and AZURE_STORAGE_QUARANTINE_CONTAINER_NAME.",
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

  private createBlobClient(
    blobName: string,
    location: StorageLocation = this.containerFor(blobName),
  ) {
    return this.createContainerClient(
      location === "legacy" ? "public" : location,
    ).getBlockBlobClient(blobName);
  }

  private createContainerClient(container: BlobContainer) {
    const config = this.requireConfiguration();
    return this.getServiceClient().getContainerClient(
      container === "quarantine"
        ? config.quarantineContainerName
        : config.containerName,
    );
  }

  private getServiceClient(): BlobServiceClient {
    const config = this.requireConfiguration();
    this.serviceClient ??= new BlobServiceClient(
      config.serviceUrl,
      config.auth === "entra"
        ? this.createTokenCredential()
        : this.getSharedKeyCredential(config),
    );
    return this.serviceClient;
  }

  private getSharedKeyCredential(config: {
    accountName: string;
    accountKey: string;
  }): StorageSharedKeyCredential {
    this.sharedKeyCredential ??= new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey,
    );
    return this.sharedKeyCredential;
  }

  /**
   * The process's identity in entra mode. DefaultAzureCredential resolves a
   * service principal from AZURE_CLIENT_ID, AZURE_TENANT_ID and
   * AZURE_CLIENT_SECRET, or else a managed identity, user-assigned when
   * AZURE_CLIENT_ID names one; see docs/backend-configuration.md.
   */
  private createTokenCredential(): TokenCredential {
    return new DefaultAzureCredential();
  }

  private containerFor(blobName: string): BlobContainer {
    return this.isQuarantineBlobName(blobName) ? "quarantine" : "public";
  }

  // Everything here was validated when the environment loaded, so a partial
  // or invalid configuration never reaches this class: no account means Azure
  // is simply not configured.
  private readConfiguration(): AzureBlobConfiguration | null {
    const { account, containerName, quarantineContainerName } =
      environment.getBlobStorageConfig();

    if (!account || !containerName || !quarantineContainerName) {
      return null;
    }

    return {
      ...account,
      containerName,
      quarantineContainerName,
      sasTtlSeconds: this.readSasTtlSeconds(),
    };
  }

  private readLocalConfiguration(): LocalBlobConfiguration | null {
    if (this.config || !environment.isDevelopment()) {
      return null;
    }

    const port = String(environment.getServerPort());
    const tokenConfig = environment.getTokenConfig();
    const signingSecret =
      tokenConfig.accessTokenSecret ?? tokenConfig.accessTokenPrivateKey;

    if (!signingSecret) {
      throw new ServiceNotImplementedError(
        "Local blob storage requires access-token signing credentials.",
      );
    }

    return {
      storageRoot: path.resolve(process.cwd(), "tmp", "blob-storage"),
      uploadTtlSeconds: LOCAL_BLOB_UPLOAD_TTL_SECONDS,
      signingSecret,
      defaultPublicOrigin: `http://localhost:${port}`,
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

  private async readLocalBlobData(
    blobName: string,
    location?: StorageLocation,
  ): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    const { blobPath, metadataPath } = this.resolveLocalBlobPaths(
      blobName,
      location,
    );

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

  private async deleteLocalBlob(
    blobName: string,
    location?: StorageLocation,
  ): Promise<void> {
    const { blobPath, metadataPath } = this.resolveLocalBlobPaths(
      blobName,
      location,
    );

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

  // Local files have no ETag, so one is derived from what a rewrite changes.
  // PUT /blob/upload stops accepting bytes once an item leaves pending_upload,
  // so locally this only guards against the backend's own overwrites; it is
  // kept so both storage paths run the same checks.
  private localEtag(stats: Pick<Stats, "mtimeMs" | "size">): string {
    return `"${Math.trunc(stats.mtimeMs * 1000).toString(16)}-${stats.size.toString(16)}"`;
  }

  // Mirrors Azure: <root>/<container>/<blob name>, the container picked by
  // name unless the caller says where to look. Before the split every blob
  // sat directly under <root>, which is the legacy location.
  private resolveLocalBlobPaths(
    blobName: string,
    location: StorageLocation = this.containerFor(blobName),
  ): {
    blobPath: string;
    metadataPath: string;
  } {
    const localConfig = this.requireLocalConfiguration();
    const blobPath = path.join(
      localConfig.storageRoot,
      location === "legacy" ? "" : location,
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
