import { OrganizationLogoService } from "@/features/organizations/organization-logo.service";
import { createMediaRule } from "../../support/media-rule";
import { testUuid } from "../../support/uuid";

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

function createService(overrides?: {
  mediaService?: Record<string, jest.Mock>;
  organizationAuditRepository?: Record<string, jest.Mock>;
}) {
  const rule = createMediaRule();
  const mediaService = {
    resolveImageReference: rule.resolveImageReference,
    isProcessedImageBlobName: rule.isProcessedImageBlobName,
    isManagedUrl: jest.fn(() => true),
    isOwnedBy: jest.fn(() => true),
    deleteMedia: jest.fn(async () => undefined),
    ...(overrides?.mediaService ?? {}),
  };
  const organizationAuditRepository = {
    hasRestorableOrganizationLogoReference: jest.fn(async () => false),
    ...(overrides?.organizationAuditRepository ?? {}),
  };

  return {
    service: new OrganizationLogoService(
      mediaService as any,
      organizationAuditRepository as any,
    ),
    mediaService,
    organizationAuditRepository,
    rule,
  };
}

describe("OrganizationLogoService", () => {
  describe("resolveLogoInput", () => {
    const mediaId = testUuid(9000, 994310);

    it("resolves a new logo from media uploaded for organizations", async () => {
      const { service, rule } = createService();
      const logo = rule.addReadyMedia(USER_1_ID, mediaId, "organizations");

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { description: "About us" },
          mediaId,
          null,
        ),
      ).resolves.toEqual({
        description: "About us",
        logoUrl: logo.blobUrl,
        logoBlobName: logo.blobName,
      });
    });

    it("refuses media uploaded for another purpose", async () => {
      const { service, rule } = createService();
      rule.addReadyMedia(USER_1_ID, mediaId, "postings");

      await expect(
        service.resolveLogoInput(USER_1_ID, {}, mediaId, null),
      ).rejects.toThrow("Image was not uploaded for organizations.");
    });

    it("keeps the stored logo, whoever uploaded it, and clears it with nulls", async () => {
      const { service, rule } = createService();
      const stored = `media/images/${testUuid(9000, 994311)}/${mediaId}.webp`;
      const profile = { logoUrl: rule.urlFor(stored), logoBlobName: stored };

      await expect(
        service.resolveLogoInput(USER_1_ID, profile, undefined, stored),
      ).resolves.toEqual(profile);
      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { logoUrl: null, logoBlobName: null },
          undefined,
          stored,
        ),
      ).resolves.toEqual({ logoUrl: null, logoBlobName: null });
      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { city: "Toronto" },
          undefined,
          stored,
        ),
      ).resolves.toEqual({ city: "Toronto" });
    });

    it("refuses a new logo sent by blob name, with the logo field names", async () => {
      const { service, rule } = createService();
      const owned = `organizations/${USER_1_ID}/logo-new.png`;

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { logoUrl: rule.urlFor(owned), logoBlobName: owned },
          undefined,
          `organizations/${USER_1_ID}/logo-old.png`,
        ),
      ).rejects.toThrow(
        "A new image must be uploaded and sent as logoMediaId.",
      );
    });

    it("treats processed media names and legacy organization names as logos", () => {
      const { service } = createService();

      expect(
        service.isLogoBlobName(`media/images/${USER_1_ID}/${mediaId}.webp`),
      ).toBe(true);
      expect(service.isLogoBlobName(`organizations/${USER_1_ID}/a.png`)).toBe(
        true,
      );
      expect(service.isLogoBlobName(`postings/${USER_1_ID}/a.png`)).toBe(false);
    });
  });

  describe("cleanupReplacedLogo", () => {
    const previousLogoBlobName = `organizations/${USER_1_ID}/logo-old.png`;
    const previousLogoUrl = `https://cdn.test/${previousLogoBlobName}`;

    it("preserves the previous managed logo when a restorable audit still references it", async () => {
      const nextLogoBlobName = `organizations/${USER_1_ID}/logo-new.png`;
      const nextLogoUrl = `https://cdn.test/${nextLogoBlobName}`;
      const { service, mediaService, organizationAuditRepository } =
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

      expect(mediaService.isManagedUrl).toHaveBeenCalledWith(
        previousLogoUrl,
        previousLogoBlobName,
      );
      expect(
        organizationAuditRepository.hasRestorableOrganizationLogoReference,
      ).toHaveBeenCalledWith({
        organizationId: ORG_1_ID,
        blobName: previousLogoBlobName,
      });
      expect(mediaService.deleteMedia).not.toHaveBeenCalled();
    });

    it("does not delete a previous managed logo the actor does not own", async () => {
      const { service, mediaService } = createService({
        mediaService: { isOwnedBy: jest.fn(() => false) },
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

      expect(mediaService.deleteMedia).not.toHaveBeenCalled();
    });

    it("deletes the previous managed logo when no restorable audit references it", async () => {
      const { service, mediaService } = createService();

      await service.cleanupReplacedLogo({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        beforeSnapshot: {
          logoUrl: previousLogoUrl,
          logoBlobName: previousLogoBlobName,
        },
        afterSnapshot: { logoUrl: null, logoBlobName: null },
      });

      expect(mediaService.deleteMedia).toHaveBeenCalledWith(
        USER_1_ID,
        previousLogoBlobName,
      );
    });
  });
});
