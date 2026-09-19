import BadRequestError from "@/errors/http/bad-request.error";
import { loggerFactory } from "@/configuration/logging";
import type { MediaService } from "@/features/media/media.service";
import type { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import { toAuditSnapshotRecord } from "@/features/organizations/audit/audit.model";
import type { OrganizationProfileInput } from "@/features/organizations/organizations.model";
import { type Uuid } from "@/configuration/validation/uuid";

// The upload scope the organization workspace uses for logos and blog covers.
export const ORGANIZATION_MEDIA_SCOPE = "organizations";

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
   * Validates the logo fields of a profile write and returns the profile to
   * store. A new logo arrives as `logoMediaId` and resolves to its processed
   * image; the stored logo may be resent unchanged; null clears it.
   */
  async resolveLogoInput(
    actorUserId: Uuid,
    profile: OrganizationProfileInput,
    logoMediaId: Uuid | undefined,
    currentLogoBlobName: string | null,
  ): Promise<OrganizationProfileInput> {
    if (logoMediaId) {
      if (profile.logoUrl || profile.logoBlobName) {
        throw new BadRequestError(
          "Send either logoMediaId or logoUrl and logoBlobName, not both.",
        );
      }

      const image = await this.mediaService.resolveAttachableImage(
        actorUserId,
        logoMediaId,
        { scope: ORGANIZATION_MEDIA_SCOPE },
      );

      return {
        ...profile,
        logoUrl: image.blobUrl,
        logoBlobName: image.blobName,
      };
    }

    this.assertLogoReference(actorUserId, profile, currentLogoBlobName);
    return profile;
  }

  isLogoBlobName(blobName: string): boolean {
    const normalized = blobName.trim();

    return (
      normalized.toLowerCase().startsWith(`${ORGANIZATION_MEDIA_SCOPE}/`) ||
      this.mediaService.isProcessedImageBlobName(normalized)
    );
  }

  private assertLogoReference(
    actorUserId: Uuid,
    profile: OrganizationProfileInput,
    currentLogoBlobName: string | null,
  ): void {
    const hasLogoUrl = profile.logoUrl !== undefined;
    const hasLogoBlobName = profile.logoBlobName !== undefined;

    if (hasLogoUrl !== hasLogoBlobName) {
      throw new BadRequestError(
        "Logo URL and logo blob name must be provided together when updating the organization logo.",
      );
    }

    if (!hasLogoUrl && !hasLogoBlobName) {
      return;
    }

    if (!profile.logoUrl && !profile.logoBlobName) {
      return;
    }

    if (!profile.logoUrl || !profile.logoBlobName) {
      throw new BadRequestError(
        "Logo URL and logo blob name must both be set or both be null.",
      );
    }

    const logoBlobName = profile.logoBlobName.trim();

    if (!this.isLogoBlobName(logoBlobName)) {
      throw new BadRequestError(
        "Organization logos must use an organizations-scoped blob.",
      );
    }

    if (!this.mediaService.isConfigured()) {
      throw new BadRequestError(
        "Organization logos require Blob Storage to be configured on the backend.",
      );
    }

    if (!this.mediaService.isManagedUrl(profile.logoUrl, logoBlobName)) {
      throw new BadRequestError(
        "Logo URL must match the Blob Storage location for the provided blob name.",
      );
    }

    // Resending the stored logo is what every save that leaves it alone does,
    // whoever uploaded it.
    if (logoBlobName === currentLogoBlobName) {
      return;
    }

    if (!this.mediaService.isOwnedBy(actorUserId, logoBlobName)) {
      throw new BadRequestError(
        "Organization logo blob must belong to the current user.",
      );
    }
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
      await this.mediaService.deleteMedia(input.actorUserId, previousBlobName);
    } catch (error) {
      this.logger.error("Failed to delete replaced organization logo blob.", {
        previousBlobName,
        nextBlobName: nextBlobName ?? undefined,
        error,
      });
    }
  }
}
