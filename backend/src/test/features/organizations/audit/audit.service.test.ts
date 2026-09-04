import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import type {
  CreateOrganizationAuditLogInput,
  ListOrganizationAuditResult,
  OrganizationAuditRecord,
} from "@/features/organizations/audit/audit.model";
import { testUuid } from "../../../support/uuid";
const AUDIT_ORIGINAL_ID = testUuid(9000, 488025);
const MISSING_AUDIT_ID = testUuid(9000, 127554);

const AUDIT_1_ID = testUuid(9000, 582877);
const AUDIT_2_ID = testUuid(9000, 582878);
const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

function createAuditLog(
  overrides: Partial<OrganizationAuditRecord> = {},
): OrganizationAuditRecord {
  return {
    id: AUDIT_ORIGINAL_ID,
    organizationId: ORG_1_ID,
    action: "organization.renamed",
    resourceType: "organization",
    resourceId: ORG_1_ID,
    organizationVersion: 1,
    summary: "Original change",
    changes: [],
    beforeSnapshot: {
      id: ORG_1_ID,
      name: "Northwind",
    },
    afterSnapshot: {
      id: ORG_1_ID,
      name: "Renamed",
    },
    restorable: true,
    restoredFromAuditId: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    ...overrides,
  } as OrganizationAuditRecord;
}

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: "membership-2",
    userId: "user-2",
    email: "teammate@example.com",
    username: "teammate",
    role: "operator",
    joinedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function createInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    email: "teammate@example.com",
    emailHint: "t***@example.com",
    role: "operator",
    status: "pending",
    expiresAt: "2099-06-01T00:00:00.000Z",
    invitedBy: {
      id: USER_1_ID,
      email: "owner@example.com",
      username: "owner-one",
    },
    organization: { id: ORG_1_ID, slug: "northwind", name: "Northwind" },
    ...overrides,
  };
}

function createListResult(): ListOrganizationAuditResult {
  return {
    auditLogs: [createAuditLog()],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

function createMembershipAccess(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: "membership-1",
    role: "primary_manager" as const,
    organization: {
      id: ORG_1_ID,
      slug: "northwind",
      name: "Northwind",
    },
    ...overrides,
  };
}

function createService(options?: {
  membership?: { role: "primary_manager" | "manager" | "operator" } | null;
  membershipAccess?: ReturnType<typeof createMembershipAccess> | null;
  auditLog?: OrganizationAuditRecord | null;
  listResult?: ListOrganizationAuditResult;
  hasLogoReference?: boolean;
}) {
  const membership =
    options && "membership" in options
      ? options.membership
      : { role: "manager" as const };
  const membershipAccess =
    options && "membershipAccess" in options
      ? options.membershipAccess
      : createMembershipAccess();
  const auditLog =
    options && "auditLog" in options ? options.auditLog : createAuditLog();

  const repository = {
    create: jest.fn(async (input: CreateOrganizationAuditLogInput) =>
      createAuditLog({
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        summary: input.summary,
      }),
    ),
    list: jest.fn(async () => options?.listResult ?? createListResult()),
    findById: jest.fn(async () => auditLog),
    hasRestorableOrganizationLogoReference: jest.fn(
      async () => options?.hasLogoReference ?? false,
    ),
  };
  const organizationAccessService = {
    findMembership: jest.fn(async () => membership),
  };
  const organizationsRepository = {
    findMembershipAccess: jest.fn(async () => membershipAccess),
    updateOrganization: jest.fn(async () => ({
      id: ORG_1_ID,
      name: "Northwind",
    })),
    restoreMembership: jest.fn(async () => ({
      membershipId: "membership-2",
      userId: "user-2",
      username: "teammate",
      role: "operator",
    })),
    reissueInvitation: jest.fn(async () => ({
      id: "invite-1",
      email: "teammate@example.com",
      emailHint: "t***@example.com",
      role: "operator",
      invitedBy: { username: "owner-one" },
    })),
  };
  const postingsRepository = {
    restoreFromSnapshot: jest.fn(),
    restoreOwnerAvailabilityBlock: jest.fn(),
  };
  const seasonalPricingRepository = {
    restore: jest.fn(),
  };
  const emailService = {
    sendOrganizationInviteEmail: jest.fn(),
  };
  const organizationLogoService = {
    cleanupReplacedLogo: jest.fn(),
  };
  const organizationPostingProjectionService = {
    cascade: jest.fn(),
  };

  return {
    repository,
    organizationAccessService,
    organizationsRepository,
    postingsRepository,
    seasonalPricingRepository,
    emailService,
    organizationLogoService,
    organizationPostingProjectionService,
    service: new OrganizationAuditService(
      repository as any,
      organizationAccessService as any,
      organizationsRepository as any,
      organizationsRepository as any,
      organizationsRepository as any,
      postingsRepository as any,
      seasonalPricingRepository as any,
      emailService as any,
      organizationLogoService as any,
      organizationPostingProjectionService as any,
    ),
  };
}

describe("OrganizationAuditService", () => {
  it("records audit entries through the repository", async () => {
    const { service, repository } = createService();

    const result = await service.record({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      action: "organization.created",
      resourceType: "organization",
      summary: "Created organization",
    });

    expect(repository.create).toHaveBeenCalledWith({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      action: "organization.created",
      resourceType: "organization",
      summary: "Created organization",
    });
    expect(result.summary).toBe("Created organization");
  });

  it("lists audit history for managers", async () => {
    const listResult = createListResult();
    const { service, repository, organizationAccessService } = createService({
      listResult,
      membership: { role: "primary_manager" },
    });

    await expect(
      service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(listResult);
    expect(organizationAccessService.findMembership).toHaveBeenCalledWith(
      USER_1_ID,
      ORG_1_ID,
    );
    expect(repository.list).toHaveBeenCalledWith({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      page: 1,
      pageSize: 20,
    });
  });

  it("rejects missing organization access when listing audit history", async () => {
    const { service } = createService({ membership: null });

    await expect(
      service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects operators from listing audit history", async () => {
    const { service } = createService({ membership: { role: "operator" } });

    await expect(
      service.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns a restorable audit entry for managers", async () => {
    const auditLog = createAuditLog({ id: AUDIT_2_ID, restorable: true });
    const { service, repository } = createService({ auditLog });

    await expect(
      service.requireRestorableAudit({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_2_ID,
      }),
    ).resolves.toEqual(auditLog);
    expect(repository.findById).toHaveBeenCalledWith(ORG_1_ID, AUDIT_2_ID);
  });

  it("rejects missing audit entries during restore", async () => {
    const { service } = createService({ auditLog: null });

    await expect(
      service.requireRestorableAudit({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: MISSING_AUDIT_ID,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects non-restorable audit entries during restore", async () => {
    const { service } = createService({
      auditLog: createAuditLog({ restorable: false }),
    });

    await expect(
      service.requireRestorableAudit({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_1_ID,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("checks whether a managed logo is still referenced by a restorable audit", async () => {
    const { service, repository } = createService({ hasLogoReference: true });

    await expect(
      service.hasRestorableOrganizationLogoReference({
        organizationId: ORG_1_ID,
        blobName: `organizations/${ORG_1_ID}/logo.png`,
      }),
    ).resolves.toBe(true);
    expect(
      repository.hasRestorableOrganizationLogoReference,
    ).toHaveBeenCalledWith({
      organizationId: ORG_1_ID,
      blobName: `organizations/${ORG_1_ID}/logo.png`,
    });
  });

  it("swallows failures when recording audit entries safely", async () => {
    const { service, repository } = createService();
    repository.create.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(
      service.recordSafely({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        action: "organization.created",
        resourceType: "organization",
        summary: "Created organization",
      }),
    ).resolves.toBeUndefined();
  });

  describe("restoreVersion", () => {
    it("preserves replaced logos during restore when a restorable audit still references them", async () => {
      const restoredLogoUrl = `https://cdn.test/organizations/${USER_1_ID}/logo-restored.png`;
      const restoredLogoBlobName = `organizations/${USER_1_ID}/logo-restored.png`;
      const previousLogoUrl = `https://cdn.test/organizations/${USER_1_ID}/logo-current.png`;
      const previousLogoBlobName = `organizations/${USER_1_ID}/logo-current.png`;
      const { service, organizationsRepository, organizationLogoService } =
        createService({
          auditLog: createAuditLog({
            beforeSnapshot: {
              id: ORG_1_ID,
              name: "Northwind",
              logoUrl: restoredLogoUrl,
              logoBlobName: restoredLogoBlobName,
            },
            afterSnapshot: {
              id: ORG_1_ID,
              name: "Renamed",
              logoUrl: previousLogoUrl,
              logoBlobName: previousLogoBlobName,
            },
          }),
        });

      await service.restoreVersion({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_ORIGINAL_ID,
      });

      expect(organizationsRepository.updateOrganization).toHaveBeenCalledWith(
        ORG_1_ID,
        expect.objectContaining({ name: "Northwind" }),
      );
      expect(organizationLogoService.cleanupReplacedLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
        }),
      );
    });

    it("restores organization audit snapshots and records a compensating audit", async () => {
      const { service, repository } = createService();

      await expect(
        service.restoreVersion({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          auditId: AUDIT_ORIGINAL_ID,
        }),
      ).resolves.toEqual({
        restored: true,
        auditLog: expect.objectContaining({
          action: "organization.restored",
        }),
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "organization.restored",
          summary: "Organization restored to Northwind.",
          restoredFromAuditId: AUDIT_ORIGINAL_ID,
          restorable: false,
        }),
      );
    });

    it("restores member audit snapshots and records a compensating audit", async () => {
      const { service, organizationsRepository, repository } = createService({
        auditLog: createAuditLog({
          resourceType: "member",
          resourceId: "membership-2",
          beforeSnapshot: createMember(),
          afterSnapshot: createMember({ role: "manager" }),
        }),
      });
      organizationsRepository.restoreMembership.mockResolvedValueOnce(
        createMember(),
      );

      await service.restoreVersion({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_ORIGINAL_ID,
      });

      expect(organizationsRepository.restoreMembership).toHaveBeenCalledWith({
        membershipId: "membership-2",
        organizationId: ORG_1_ID,
        userId: "user-2",
        role: "operator",
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "member.restored",
          summary: "teammate was restored as operator.",
        }),
      );
    });

    it("restores posting snapshots through the postings repository", async () => {
      const restored = { id: "posting-1", name: "Camera Kit" };
      const { service, postingsRepository, repository } = createService({
        auditLog: createAuditLog({
          resourceType: "posting",
          resourceId: "posting-1",
          beforeSnapshot: restored,
          afterSnapshot: null,
        }),
      });
      postingsRepository.restoreFromSnapshot.mockResolvedValueOnce(restored);

      await service.restoreVersion({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_ORIGINAL_ID,
      });

      expect(postingsRepository.restoreFromSnapshot).toHaveBeenCalledWith(
        restored,
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "posting.restored",
          resourceType: "posting",
        }),
      );
    });

    it("restores posting availability snapshots through the postings repository", async () => {
      const restored = { id: "block-1" };
      const { service, postingsRepository, repository } = createService({
        auditLog: createAuditLog({
          resourceType: "posting_availability",
          resourceId: "block-1",
          beforeSnapshot: restored,
          afterSnapshot: null,
        }),
      });
      postingsRepository.restoreOwnerAvailabilityBlock.mockResolvedValueOnce(
        restored,
      );

      await service.restoreVersion({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_ORIGINAL_ID,
      });

      expect(
        postingsRepository.restoreOwnerAvailabilityBlock,
      ).toHaveBeenCalledWith(restored);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "posting_availability.restored",
          resourceType: "posting_availability",
        }),
      );
    });

    it("restores seasonal pricing snapshots through the seasonal pricing repository", async () => {
      const restored = { id: "price-1", name: "Summer" };
      const { service, seasonalPricingRepository, repository } = createService({
        auditLog: createAuditLog({
          resourceType: "seasonal_pricing",
          resourceId: "price-1",
          beforeSnapshot: restored,
          afterSnapshot: null,
        }),
      });
      seasonalPricingRepository.restore.mockResolvedValueOnce(restored);

      await service.restoreVersion({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        auditId: AUDIT_ORIGINAL_ID,
      });

      expect(seasonalPricingRepository.restore).toHaveBeenCalledWith(restored);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "seasonal_pricing.restored",
          resourceType: "seasonal_pricing",
        }),
      );
    });

    it("restores invitations by issuing a fresh invite token", async () => {
      const { service, organizationsRepository, emailService, repository } =
        createService({
          auditLog: createAuditLog({
            resourceType: "invitation",
            resourceId: "invite-1",
            beforeSnapshot: createInvitation(),
            afterSnapshot: createInvitation({ status: "revoked" }),
          }),
        });
      organizationsRepository.reissueInvitation.mockResolvedValueOnce(
        createInvitation(),
      );

      await expect(
        service.restoreVersion({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          auditId: AUDIT_ORIGINAL_ID,
        }),
      ).resolves.toEqual({
        restored: true,
        auditLog: expect.objectContaining({
          action: "invitation.restored",
        }),
      });
      expect(organizationsRepository.reissueInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "teammate@example.com",
          role: "operator",
          tokenHash: expect.any(String),
        }),
      );
      expect(emailService.sendOrganizationInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "teammate@example.com",
          role: "operator",
          token: expect.any(String),
        }),
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "invitation.restored",
          restoredFromAuditId: AUDIT_ORIGINAL_ID,
        }),
      );
    });

    it("rejects unrestorable organization snapshots", async () => {
      const { service } = createService({
        auditLog: createAuditLog({
          beforeSnapshot: { id: ORG_1_ID },
        }),
      });

      await expect(
        service.restoreVersion({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          auditId: AUDIT_ORIGINAL_ID,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("prevents managers from restoring organization rename audits", async () => {
      const { service, organizationsRepository } = createService({
        membershipAccess: createMembershipAccess({ role: "manager" }),
      });

      await expect(
        service.restoreVersion({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          auditId: AUDIT_ORIGINAL_ID,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(organizationsRepository.updateOrganization).not.toHaveBeenCalled();
    });

    it("prevents managers from restoring member role-update audits", async () => {
      const { service, repository } = createService({
        membershipAccess: createMembershipAccess({ role: "manager" }),
        auditLog: createAuditLog({
          action: "member.role_updated",
          resourceType: "member",
          resourceId: "membership-2",
          beforeSnapshot: createMember({ role: "manager" }),
          afterSnapshot: createMember({ role: "operator" }),
        }),
      });

      await expect(
        service.restoreVersion({
          organizationId: ORG_1_ID,
          actorUserId: USER_1_ID,
          auditId: AUDIT_ORIGINAL_ID,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });
});
