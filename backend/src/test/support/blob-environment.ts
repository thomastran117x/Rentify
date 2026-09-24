const BLOB_ENVIRONMENT_VARIABLES = [
  "NODE_ENV",
  "ACCESS_TOKEN_SECRET",
  "PORT",
  "AZURE_STORAGE_CONNECTION_STRING",
  "AZURE_STORAGE_CONTAINER_NAME",
  "AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS",
  "ALLOWED_IMAGE_TYPES",
  "MAX_IMAGE_SIZE_BYTES",
  "MAX_IMAGE_WIDTH",
  "MAX_IMAGE_HEIGHT",
  "MAX_IMAGE_PIXELS",
  "MAX_PROCESSED_IMAGE_EDGE",
] as const;

/**
 * Registers an afterEach that puts every blob- and image-related environment
 * variable back the way the suite found it.
 *
 * Assigning undefined to a process.env key stores the string "undefined"
 * rather than clearing it. PORT in particular then leaks a bad value into every
 * later suite in the shared --runInBand process, so unset means delete.
 */
export function restoreBlobEnvironmentAfterEach(): void {
  const original = Object.fromEntries(
    BLOB_ENVIRONMENT_VARIABLES.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const name of BLOB_ENVIRONMENT_VARIABLES) {
      const value = original[name];

      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}

/** Selects the development-only local-disk storage instead of Azure. */
export function useLocalBlobStorage(): void {
  process.env.NODE_ENV = "development";
  process.env.ACCESS_TOKEN_SECRET = "blob-test-secret";
  process.env.PORT = "8040";
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_CONTAINER_NAME;
}

export function useAzureBlobStorage(): void {
  process.env.NODE_ENV = "test";
  process.env.AZURE_STORAGE_CONNECTION_STRING =
    "DefaultEndpointsProtocol=https;AccountName=rent;AccountKey=key";
  process.env.AZURE_STORAGE_CONTAINER_NAME = "uploads";
  delete process.env.AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS;
}

/** Reads the signed parameters back out of a local upload URL. */
export function readLocalUploadUrl(uploadUrl: string): {
  blobName: string;
  expiresAt: string;
  token: string;
} {
  const url = new URL(uploadUrl);

  return {
    blobName: url.searchParams.get("blobName")!,
    expiresAt: url.searchParams.get("expiresAt")!,
    token: url.searchParams.get("token")!,
  };
}
