import { loggerFactory } from "@/configuration/logging";
import type { MediaService } from "@/features/media/media.service";
import type { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import { toAuditSnapshotRecord } from "@/features/organizations/audit/audit.model";
import type { OrganizationProfileInput } from "@/features/organizations/organizations.model";
import { type Uuid } from "@/configuration/validation/uuid";

// Logos stored before media records existed were named under this prefix.
const LEGACY_LOGO_BLOB_PREFIX = "organizations/";

const LOGO_FIELDS = {
  mediaId: "logoMediaId",
  url: "logoUrl",
  blobName: "logoBlobName",
} as const;

/**
 * Validates and cleans up the organization logo blob reference, shared by
 * profile updates/creation and audit-driven restores (both can leave a
 * replaced logo blob orphaned).
 */
export class OrganizationLogoService {
  private readonly logger = loggerFactory.forClass(
    OrganizationLogoService,
    "service",
  );

  constructor(
    private readonly mediaService: MediaService,
    private readonly organizationAuditRepository: OrganizationAuditRepository,
  ) {}

  /**
   * Applies MediaService's image rule to the logo fields of a profile write and
   * returns the profile to store.
   */
  async resolveLogoInput(
    actorUserId: Uuid,
    profile: OrganizationProfileInput,
    logoMediaId: Uuid | undefined,
    currentLogoBlobName: string | null,
  ): Promise<OrganizationProfileInput> {
    const logo = await this.mediaService.resolveImageReference(
      actorUserId,
      {
        mediaId: logoMediaId,
        url: profile.logoUrl,
        blobName: profile.logoBlobName,
      },
      {
        scope: "organizations",
        storedBlobNames: new Set(
          currentLogoBlobName ? [currentLogoBlobName] : [],
        ),
        fields: LOGO_FIELDS,
      },
    );

    if (logo === undefined) {
      return profile;
    }

    return {
      ...profile,
      logoUrl: logo?.blobUrl ?? null,
      logoBlobName: logo?.blobName ?? null,
    };
  }

  isLogoBlobName(blobName: string): boolean {
    const normalized = blobName.trim();

    return (
      normalized.toLowerCase().startsWith(LEGACY_LOGO_BLOB_PREFIX) ||
      this.mediaService.isProcessedImageBlobName(normalized)
    );
  }

  async cleanupReplacedLogo(input: {
    organizationId: Uuid;
    actorUserId: Uuid;
    beforeSnapshot: unknown;
    afterSnapshot: unknown;
  }): Promise<void> {
    const beforeRecord = toAuditSnapshotRecord(input.beforeSnapshot);
    const afterRecord = toAuditSnapshotRecord(input.afterSnapshot);
    const previousBlobName =
      typeof beforeRecord.logoBlobName === "string"
        ? beforeRecord.logoBlobName
        : null;
    const previousBlobUrl =
      typeof beforeRecord.logoUrl === "string" ? beforeRecord.logoUrl : null;
    const nextBlobName =
      typeof afterRecord.logoBlobName === "string"
        ? afterRecord.logoBlobName
        : null;

    if (
      !previousBlobName ||
      previousBlobName === nextBlobName ||
      !previousBlobUrl ||
      !this.mediaService.isManagedUrl(previousBlobUrl, previousBlobName) ||
      !this.isLogoBlobName(previousBlobName) ||
      !this.mediaService.isOwnedBy(input.actorUserId, previousBlobName)
    ) {
      return;
    }

    const isReferencedByRestorableAudit =
      await this.organizationAuditRepository.hasRestorableOrganizationLogoReference(
        {
          organizationId: input.organizationId,
          blobName: previousBlobName,
        },
      );

    if (isReferencedByRestorableAudit) {
      return;
    }

    try {
      await this.mediaService.deleteReplacedImageByBlobName(
        input.actorUserId,
        previousBlobName,
      );
    } catch (error) {
      this.logger.error("Failed to delete replaced organization logo blob.", {
        previousBlobName,
        nextBlobName: nextBlobName ?? undefined,
        error,
      });
    }
  }
}
