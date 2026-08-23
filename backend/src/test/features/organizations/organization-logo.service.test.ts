import { OrganizationLogoService } from "@/features/organizations/organization-logo.service";

function createService(overrides?: {
  blobService?: Record<string, jest.Mock>;
  organizationAuditRepository?: Record<string, jest.Mock>;
}) {
  const blobService = {
    isConfigured: jest.fn(() => true),
    isManagedBlobUrl: jest.fn(() => true),
    isBlobOwnedByUser: jest.fn(() => true),
    deleteBlob: jest.fn(async () => undefined),
    ...(overrides?.blobService ?? {}),
  };
  const organizationAuditRepository = {
    hasRestorableOrganizationLogoReference: jest.fn(async () => false),
    ...(overrides?.organizationAuditRepository ?? {}),
  };

  return {
    service: new OrganizationLogoService(
      blobService as any,
      organizationAuditRepository as any,
    ),
    blobService,
    organizationAuditRepository,
  };
}

describe("OrganizationLogoService", () => {
  describe("assertLogoInput", () => {
    it("rejects organization logo blobs outside the organizations scope", () => {
      const { service } = createService();

      expect(() =>
        service.assertLogoInput("user-1", {
          logoUrl: "https://cdn.test/postings/user-1/photo.png",
          logoBlobName: "postings/user-1/photo.png",
        }),
      ).toThrow("Organization logos must use an organizations-scoped blob.");
    });

    it("rejects organization logo blobs not owned by the current user", () => {
      const nextLogoBlobName = "organizations/user-9/logo-new.png";
      const nextLogoUrl = `https://cdn.test/${nextLogoBlobName}`;
      const { service } = createService({
        blobService: { isBlobOwnedByUser: jest.fn(() => false) },
      });

      expect(() =>
        service.assertLogoInput("user-1", {
          logoUrl: nextLogoUrl,
          logoBlobName: nextLogoBlobName,
        }),
      ).toThrow("Organization logo blob must belong to the current user.");
    });

    it("allows clearing the logo", () => {
      const { service } = createService();

      expect(() =>
        service.assertLogoInput("user-1", {
          logoUrl: null,
          logoBlobName: null,
        }),
      ).not.toThrow();
    });
  });

  describe("cleanupReplacedLogo", () => {
    const previousLogoBlobName = "organizations/user-1/logo-old.png";
    const previousLogoUrl = `https://cdn.test/${previousLogoBlobName}`;

    it("preserves the previous managed logo when a restorable audit still references it", async () => {
      const nextLogoBlobName = "organizations/user-1/logo-new.png";
      const nextLogoUrl = `https://cdn.test/${nextLogoBlobName}`;
      const { service, blobService, organizationAuditRepository } =
        createService({
          organizationAuditRepository: {
            hasRestorableOrganizationLogoReference: jest.fn(async () => true),
          },
        });

      await service.cleanupReplacedLogo({
        organizationId: "org-1",
        actorUserId: "user-1",
        beforeSnapshot: {
          logoUrl: previousLogoUrl,
          logoBlobName: previousLogoBlobName,
        },
        afterSnapshot: {
          logoUrl: nextLogoUrl,
          logoBlobName: nextLogoBlobName,
        },
      });

      expect(blobService.isManagedBlobUrl).toHaveBeenCalledWith(
        previousLogoUrl,
        previousLogoBlobName,
      );
      expect(
        organizationAuditRepository.hasRestorableOrganizationLogoReference,
      ).toHaveBeenCalledWith({
        organizationId: "org-1",
        blobName: previousLogoBlobName,
      });
      expect(blobService.deleteBlob).not.toHaveBeenCalled();
    });

    it("does not delete a previous managed logo the actor does not own", async () => {
      const { service, blobService } = createService({
        blobService: { isBlobOwnedByUser: jest.fn(() => false) },
      });

      await service.cleanupReplacedLogo({
        organizationId: "org-1",
        actorUserId: "user-1",
        beforeSnapshot: {
          logoUrl: previousLogoUrl,
          logoBlobName: previousLogoBlobName,
        },
        afterSnapshot: { logoUrl: null, logoBlobName: null },
      });

      expect(blobService.deleteBlob).not.toHaveBeenCalled();
    });

    it("deletes the previous managed logo when no restorable audit references it", async () => {
      const { service, blobService } = createService();

      await service.cleanupReplacedLogo({
        organizationId: "org-1",
        actorUserId: "user-1",
        beforeSnapshot: {
          logoUrl: previousLogoUrl,
          logoBlobName: previousLogoBlobName,
        },
        afterSnapshot: { logoUrl: null, logoBlobName: null },
      });

      expect(blobService.deleteBlob).toHaveBeenCalledWith(previousLogoBlobName);
    });
  });
});
