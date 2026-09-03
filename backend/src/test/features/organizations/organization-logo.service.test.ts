import { OrganizationLogoService } from "@/features/organizations/organization-logo.service";
import { testUuid } from "../../support/uuid";

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

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
        service.assertLogoInput(USER_1_ID, {
          logoUrl: `https://cdn.test/postings/${USER_1_ID}/photo.png`,
          logoBlobName: `postings/${USER_1_ID}/photo.png`,
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
        service.assertLogoInput(USER_1_ID, {
          logoUrl: nextLogoUrl,
          logoBlobName: nextLogoBlobName,
        }),
      ).toThrow("Organization logo blob must belong to the current user.");
    });

    it("allows clearing the logo", () => {
      const { service } = createService();

      expect(() =>
        service.assertLogoInput(USER_1_ID, {
          logoUrl: null,
          logoBlobName: null,
        }),
      ).not.toThrow();
    });
  });

  describe("cleanupReplacedLogo", () => {
    const previousLogoBlobName = `organizations/${USER_1_ID}/logo-old.png`;
    const previousLogoUrl = `https://cdn.test/${previousLogoBlobName}`;

    it("preserves the previous managed logo when a restorable audit still references it", async () => {
      const nextLogoBlobName = `organizations/${USER_1_ID}/logo-new.png`;
      const nextLogoUrl = `https://cdn.test/${nextLogoBlobName}`;
      const { service, blobService, organizationAuditRepository } =
        createService({
          organizationAuditRepository: {
            hasRestorableOrganizationLogoReference: jest.fn(async () => true),
          },
        });

      await service.cleanupReplacedLogo({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
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
        organizationId: ORG_1_ID,
        blobName: previousLogoBlobName,
      });
      expect(blobService.deleteBlob).not.toHaveBeenCalled();
    });

    it("does not delete a previous managed logo the actor does not own", async () => {
      const { service, blobService } = createService({
        blobService: { isBlobOwnedByUser: jest.fn(() => false) },
      });

      await service.cleanupReplacedLogo({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
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
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
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
