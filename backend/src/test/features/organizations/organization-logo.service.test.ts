import { OrganizationLogoService } from "@/features/organizations/organization-logo.service";
import { testUuid } from "../../support/uuid";

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

function createService(overrides?: {
  mediaService?: Record<string, jest.Mock>;
  organizationAuditRepository?: Record<string, jest.Mock>;
}) {
  const mediaService = {
    isConfigured: jest.fn(() => true),
    isManagedUrl: jest.fn(() => true),
    isOwnedBy: jest.fn(() => true),
    isProcessedImageBlobName: jest.fn((blobName: string) =>
      blobName.startsWith("media/images/"),
    ),
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
  };
}

describe("OrganizationLogoService", () => {
  describe("resolveLogoInput", () => {
    const mediaId = testUuid(9000, 994310);

    it("rejects organization logo blobs outside the organizations scope", async () => {
      const { service } = createService();

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          {
            logoUrl: `https://cdn.test/postings/${USER_1_ID}/photo.png`,
            logoBlobName: `postings/${USER_1_ID}/photo.png`,
          },
          undefined,
          null,
        ),
      ).rejects.toThrow(
        "Organization logos must use an organizations-scoped blob.",
      );
    });

    it("refuses a new logo sent by blob name, even one the actor uploaded", async () => {
      const nextLogoBlobName = `organizations/${USER_1_ID}/logo-new.png`;
      const { service } = createService();

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          {
            logoUrl: `https://cdn.test/${nextLogoBlobName}`,
            logoBlobName: nextLogoBlobName,
          },
          undefined,
          `organizations/${USER_1_ID}/logo-old.png`,
        ),
      ).rejects.toThrow(
        "A new organization logo must be uploaded and sent as logoMediaId.",
      );
    });

    it("accepts the stored logo resent unchanged, whoever uploaded it", async () => {
      const storedBlobName = `media/images/${testUuid(9000, 994311)}/${mediaId}.webp`;
      const { service } = createService({
        mediaService: { isOwnedBy: jest.fn(() => false) },
      });
      const profile = {
        logoUrl: `https://cdn.test/${storedBlobName}`,
        logoBlobName: storedBlobName,
      };

      await expect(
        service.resolveLogoInput(USER_1_ID, profile, undefined, storedBlobName),
      ).resolves.toEqual(profile);
    });

    it("allows clearing the logo", async () => {
      const { service } = createService();

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { logoUrl: null, logoBlobName: null },
          undefined,
          null,
        ),
      ).resolves.toEqual({ logoUrl: null, logoBlobName: null });
    });

    it("resolves a new logo from a ready media item in the organizations scope", async () => {
      const resolveAttachableImage = jest.fn(async () => ({
        blobName: `media/images/${USER_1_ID}/${mediaId}.webp`,
        blobUrl: `https://cdn.test/media/images/${USER_1_ID}/${mediaId}.webp`,
      }));
      const { service } = createService({
        mediaService: { resolveAttachableImage },
      });

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { description: "About us" },
          mediaId,
          null,
        ),
      ).resolves.toEqual({
        description: "About us",
        logoUrl: `https://cdn.test/media/images/${USER_1_ID}/${mediaId}.webp`,
        logoBlobName: `media/images/${USER_1_ID}/${mediaId}.webp`,
      });
      expect(resolveAttachableImage).toHaveBeenCalledWith(USER_1_ID, mediaId, {
        scope: "organizations",
      });
    });

    it("refuses a media id sent alongside a blob reference", async () => {
      const { service } = createService();

      await expect(
        service.resolveLogoInput(
          USER_1_ID,
          { logoUrl: "https://cdn.test/a.png", logoBlobName: "a.png" },
          mediaId,
          null,
        ),
      ).rejects.toThrow(
        "Send either logoMediaId or logoUrl and logoBlobName, not both.",
      );
    });

    it("treats processed media names as logo blobs", () => {
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
