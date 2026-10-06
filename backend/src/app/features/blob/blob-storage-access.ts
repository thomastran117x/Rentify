import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { environment } from "@/configuration/environment/index";
import type { AppEnvironment } from "@/configuration/environment/types";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";

// The scope Azure Storage data requests are authorized for, in every cloud.
const AZURE_STORAGE_SCOPE = "https://storage.azure.com/.default";

/**
 * This process's Microsoft Entra ID identity for blob storage.
 * DefaultAzureCredential resolves a service principal from AZURE_CLIENT_ID,
 * AZURE_TENANT_ID and AZURE_CLIENT_SECRET, or else a managed identity,
 * user-assigned when AZURE_CLIENT_ID names one; see
 * docs/backend-configuration.md.
 */
export function createBlobStorageCredential(): TokenCredential {
  return new DefaultAzureCredential();
}

export interface BlobStorageAccessDependencies {
  blobStorage: AppEnvironment["blobStorage"];
  createCredential: () => TokenCredential;
  logger: Pick<Logger, "warn">;
}

/**
 * Run at startup by every process that touches blobs, right after the
 * environment loads and before any other I/O.
 *
 * In entra mode it signs in, so a process without a usable identity fails to
 * boot instead of failing every blob operation later. It proves the identity
 * only: whether that identity's roles allow an operation is still decided by
 * Azure per request. In the deprecated connection-string mode it logs the
 * deprecation warning. Without Azure it does nothing.
 */
export async function checkBlobStorageAccess(
  overrides: Partial<BlobStorageAccessDependencies> = {},
): Promise<void> {
  const account = (overrides.blobStorage ?? environment.getBlobStorageConfig())
    .account;

  if (!account) {
    return;
  }

  if (account.auth === "connection-string") {
    (
      overrides.logger ??
      loggerFactory.forComponent("blob-storage-access", "app")
    ).warn(
      "AZURE_STORAGE_AUTH=connection-string is deprecated and will be removed. The account key it signs with can do anything to any blob; move this process to AZURE_STORAGE_AUTH=entra (see docs/backend-configuration.md).",
    );
    return;
  }

  const createCredential =
    overrides.createCredential ?? createBlobStorageCredential;
  let token: Awaited<ReturnType<TokenCredential["getToken"]>>;

  try {
    token = await createCredential().getToken(AZURE_STORAGE_SCOPE);
  } catch (error) {
    throw blobStorageSignInFailed(error);
  }

  if (!token) {
    throw blobStorageSignInFailed(undefined);
  }
}

function blobStorageSignInFailed(cause: unknown): Error {
  return new Error(
    "Could not sign in to Azure Storage as this process's Microsoft Entra ID identity. Check its AZURE_CLIENT_ID, AZURE_TENANT_ID and AZURE_CLIENT_SECRET, or its managed identity; see docs/backend-configuration.md.",
    { cause },
  );
}
