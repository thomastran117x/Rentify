import { DefaultAzureCredential } from "@azure/identity";
import type { AppEnvironment } from "@/configuration/environment/types";
import {
  checkBlobStorageAccess,
  createBlobStorageCredential,
} from "@/features/blob/blob-storage-access";

const CONTAINERS = {
  containerName: "uploads",
  quarantineContainerName: "uploads-quarantine",
  quarantineLegacyFallback: false,
  uploadSasTtlSeconds: 900,
};

function blobStorage(
  account: AppEnvironment["blobStorage"]["account"],
): AppEnvironment["blobStorage"] {
  return { auth: account?.auth ?? "entra", account, ...CONTAINERS };
}

const ENTRA = blobStorage({
  auth: "entra",
  accountName: "rent",
  serviceUrl: "https://rent.blob.core.windows.net",
});

describe("checkBlobStorageAccess", () => {
  it("does nothing when Azure is not configured", async () => {
    const createCredential = jest.fn();
    const logger = { warn: jest.fn() };

    await checkBlobStorageAccess({
      blobStorage: blobStorage(undefined),
      createCredential,
      logger,
    });

    expect(createCredential).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns that the connection-string mode is deprecated, without signing in", async () => {
    const createCredential = jest.fn();
    const logger = { warn: jest.fn() };

    await checkBlobStorageAccess({
      blobStorage: blobStorage({
        auth: "connection-string",
        accountName: "rent",
        accountKey: "key",
        serviceUrl: "https://rent.blob.core.windows.net",
      }),
      createCredential,
      logger,
    });

    expect(createCredential).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "AZURE_STORAGE_AUTH=connection-string is deprecated",
      ),
    );
  });

  it("signs in for Azure Storage in entra mode", async () => {
    const getToken = jest.fn(async () => ({
      token: "token",
      expiresOnTimestamp: Date.now() + 60_000,
    }));

    await expect(
      checkBlobStorageAccess({
        blobStorage: ENTRA,
        createCredential: () => ({ getToken }),
      }),
    ).resolves.toBeUndefined();
    expect(getToken).toHaveBeenCalledWith("https://storage.azure.com/.default");
  });

  it("stops boot when the identity cannot sign in", async () => {
    const unavailable = new Error("EnvironmentCredential is unavailable.");

    const failure = await checkBlobStorageAccess({
      blobStorage: ENTRA,
      createCredential: () => ({
        getToken: jest.fn(async () => {
          throw unavailable;
        }),
      }),
    }).catch((error: unknown) => error as Error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "Could not sign in to Azure Storage as this process's Microsoft Entra ID identity.",
    );
    expect((failure as Error).cause).toBe(unavailable);
  });

  it("stops boot when the identity returns no token", async () => {
    await expect(
      checkBlobStorageAccess({
        blobStorage: ENTRA,
        createCredential: () => ({ getToken: jest.fn(async () => null) }),
      }),
    ).rejects.toThrow("Could not sign in to Azure Storage");
  });

  it("builds the identity with DefaultAzureCredential", () => {
    expect(createBlobStorageCredential()).toBeInstanceOf(
      DefaultAzureCredential,
    );
  });
});
