// Session-storage bookkeeping for organization logo blobs staged before save.
// Staged blobs are cleaned up on the next load / page hide if never committed.

const ORGANIZATION_LOGO_STORAGE_PREFIX =
  "organization-workspace:staged-logo-blobs";

export function getOrganizationLogoStorageKey(userId: string): string {
  return `${ORGANIZATION_LOGO_STORAGE_PREFIX}:${userId}`;
}

export function readStagedOrganizationLogoBlobNames(userId: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(
      getOrganizationLogoStorageKey(userId),
    );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

export function writeStagedOrganizationLogoBlobNames(
  userId: string,
  blobNames: Iterable<string>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedBlobNames = [
    ...new Set(
      Array.from(blobNames)
        .map((blobName) => blobName.trim())
        .filter(Boolean),
    ),
  ];
  const storageKey = getOrganizationLogoStorageKey(userId);

  if (normalizedBlobNames.length === 0) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }

  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify(normalizedBlobNames),
  );
}
