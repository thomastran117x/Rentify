import BadRequestError from "@/errors/http/bad-request.error";
import { loggerFactory } from "@/configuration/logging";
import type { BlobService } from "@/features/blob/blob.service";
import type { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import { toAuditSnapshotRecord } from "@/features/organizations/audit/audit.model";
import type { OrganizationProfileInput } from "@/features/organizations/organizations.model";

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
    private readonly blobService: BlobService,
    private readonly organizationAuditRepository: OrganizationAuditRepository,
  ) {}

  assertLogoInput(
    actorUserId: string,
    profile: OrganizationProfileInput,
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

    if (!this.blobService.isConfigured()) {
      throw new BadRequestError(
        "Organization logos require Blob Storage to be configured on the backend.",
      );
    }

    if (!this.blobService.isManagedBlobUrl(profile.logoUrl, logoBlobName)) {
      throw new BadRequestError(
        "Logo URL must match the Blob Storage location for the provided blob name.",
      );
    }

    if (!this.blobService.isBlobOwnedByUser(actorUserId, logoBlobName)) {
      throw new BadRequestError(
        "Organization logo blob must belong to the current user.",
      );
    }
  }

  isLogoBlobName(blobName: string): boolean {
    return blobName.trim().toLowerCase().startsWith("organizations/");
  }

  async cleanupReplacedLogo(input: {
    organizationId: string;
    actorUserId: string;
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
      !this.blobService.isManagedBlobUrl(previousBlobUrl, previousBlobName) ||
      !this.isLogoBlobName(previousBlobName) ||
      !this.blobService.isBlobOwnedByUser(input.actorUserId, previousBlobName)
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
      await this.blobService.deleteBlob(previousBlobName);
    } catch (error) {
      this.logger.error("Failed to delete replaced organization logo blob.", {
        previousBlobName,
        nextBlobName: nextBlobName ?? undefined,
        error,
      });
    }
  }
}
