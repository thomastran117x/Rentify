import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { buildApiPath } from "@/configuration/http/api-path";
import { getOptionalEnvironmentVariable } from "@/configuration/environment/index";
import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
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

interface LocalBlobConfiguration {
  storageRoot: string;
  uploadTtlSeconds: number;
  signingSecret: string;
  defaultPublicOrigin: string;
}

const DEFAULT_SCOPE = "general";
const DEFAULT_SAS_TTL_SECONDS = 15 * 60;
const MAX_SAS_TTL_SECONDS = 60 * 60;
const MIN_SAS_TTL_SECONDS = 60;
const SAFE_CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const LOCAL_BLOB_CONTAINER_NAME = "local-dev";
const LOCAL_BLOB_UPLOAD_PATH = buildApiPath("/blob/upload");
const LOCAL_BLOB_FILE_PATH = buildApiPath("/blob/file");

export class BlobService {
  private readonly config: AzureBlobConfiguration | null;
  private readonly localConfig: LocalBlobConfiguration | null;

  constructor() {
    this.config = this.readConfiguration();
    this.localConfig = this.readLocalConfiguration();
  }

  createUploadUrl(input: CreateBlobUploadUrlInput): BlobUploadTarget {
    const contentType = this.normalizeContentType(input.contentType);
    const blobName = this.buildBlobName(
      input.userId,
      input.filename,
      input.scope,
    );

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

  async uploadLocalBlob(input: {
    blobName: string;
    expiresAt: string;
    token: string;
    contentType: string;
    body: Buffer;
  }): Promise<void> {
    this.requireLocalConfiguration();
    this.assertLocalUploadToken(input.blobName, input.expiresAt, input.token);
    const contentType = this.normalizeContentType(input.contentType);
    await this.writeLocalBlob(input.blobName, input.body, contentType);
  }

  async readLocalBlob(blobName: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    this.requireLocalConfiguration();
    return this.readLocalBlobData(blobName);
  }

  async deleteBlobForUser(userId: string, blobName: string): Promise<void> {
    const normalizedBlobName = this.normalizeBlobName(blobName);
    this.assertUserOwnsBlob(userId, normalizedBlobName);
    await this.deleteBlob(normalizedBlobName);
  }

  async deleteBlob(blobName: string): Promise<void> {
    const normalizedBlobName = this.normalizeBlobName(blobName);

    if (this.config) {
      await this.createBlobClient(normalizedBlobName).deleteIfExists();
      return;
    }

    await this.deleteLocalBlob(normalizedBlobName);
  }

  async downloadBlob(blobName: string): Promise<{
    body: Buffer;
    contentType?: string;
  }> {
    if (this.config) {
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

    return `${directory === "." ? "" : `${directory}/`}thumbnails/${baseName}.webp`;
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

  private readLocalConfiguration(): LocalBlobConfiguration | null {
    if (this.config || process.env.NODE_ENV !== "development") {
      return null;
    }

    const rawPort = getOptionalEnvironmentVariable("PORT")?.trim();
    const port = rawPort && /^[0-9]+$/.test(rawPort) ? rawPort : "8040";
    const signingSecret =
      getOptionalEnvironmentVariable("ACCESS_TOKEN_SECRET") ??
      "local-dev-blob-secret";

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

  private assertLocalUploadToken(
    blobName: string,
    expiresAt: string,
    token: string,
  ): void {
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

  private assertUserOwnsBlob(userId: string, blobName: string): void {
    const segments = blobName.split("/");

    if (segments.length < 3 || segments[1] !== userId) {
      throw new BadRequestError("Blob name is invalid.");
    }
  }

  private async writeLocalBlob(
    blobName: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const localConfig = this.requireLocalConfiguration();
    const normalizedBlobName = this.normalizeBlobName(blobName);
    const blobPath = path.join(
      localConfig.storageRoot,
      normalizedBlobName.replace(/\//g, path.sep),
    );
    const metadataPath = `${blobPath}.meta.json`;

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

  private async readLocalBlobData(blobName: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    const localConfig = this.requireLocalConfiguration();
    const normalizedBlobName = this.normalizeBlobName(blobName);
    const blobPath = path.join(
      localConfig.storageRoot,
      normalizedBlobName.replace(/\//g, path.sep),
    );
    const metadataPath = `${blobPath}.meta.json`;

    try {
      const [body, metadataRaw] = await Promise.all([
        readFile(blobPath),
        readFile(metadataPath, "utf8"),
      ]);
      const metadata = JSON.parse(metadataRaw) as {
        contentType?: string;
      };

      return {
        body,
        contentType:
          metadata.contentType &&
          SAFE_CONTENT_TYPE_PATTERN.test(metadata.contentType)
            ? metadata.contentType
            : "application/octet-stream",
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ResourceNotFoundError("Blob not found.");
      }

      throw error;
    }
  }

  private async deleteLocalBlob(blobName: string): Promise<void> {
    const localConfig = this.requireLocalConfiguration();
    const blobPath = path.join(
      localConfig.storageRoot,
      blobName.replace(/\//g, path.sep),
    );
    const metadataPath = `${blobPath}.meta.json`;

    const results = await Promise.allSettled([
      unlink(blobPath),
      unlink(metadataPath),
    ]);
    const unexpectedFailure = results.find(
      (result) =>
        result.status === "rejected" &&
        (!result.reason ||
          typeof result.reason !== "object" ||
          !("code" in result.reason) ||
          result.reason.code !== "ENOENT"),
    );

    if (unexpectedFailure?.status === "rejected") {
      throw unexpectedFailure.reason;
    }
  }
}
