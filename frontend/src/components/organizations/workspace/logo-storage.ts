// Session-storage bookkeeping for organization logo media uploaded before save.
// Staged media is deleted on the next load / page hide if never committed.

const ORGANIZATION_LOGO_STORAGE_PREFIX =
  "organization-workspace:staged-logo-media";

export function getOrganizationLogoStorageKey(userId: string): string {
  return `${ORGANIZATION_LOGO_STORAGE_PREFIX}:${userId}`;
}

export function readStagedOrganizationLogoMediaIds(userId: string): string[] {
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

export function writeStagedOrganizationLogoMediaIds(
  userId: string,
  mediaIds: Iterable<string>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedMediaIds = [
    ...new Set(
      Array.from(mediaIds)
        .map((mediaId) => mediaId.trim())
        .filter(Boolean),
    ),
  ];
  const storageKey = getOrganizationLogoStorageKey(userId);

  if (normalizedMediaIds.length === 0) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }

  window.sessionStorage.setItem(storageKey, JSON.stringify(normalizedMediaIds));
}
