import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import type {
  CreateOrganizationAuditLogInput,
  ListOrganizationAuditResult,
  OrganizationAuditRecord,
} from "@/features/organizations/organization-audit.model";

function createAuditLog(
  overrides: Partial<OrganizationAuditRecord> = {},
): OrganizationAuditRecord {
  return {
    id: "audit-1",
    organizationId: "org-1",
    action: "organization.created",
    resourceType: "organization",
    organizationVersion: 1,
    summary: "Created organization",
    changes: [],
    restorable: true,
    createdAt: "2026-07-16T00:00:00.000Z",
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

function createService(options?: {
  membership?: { role: "primary_manager" | "manager" | "operator" } | null;
  auditLog?: OrganizationAuditRecord | null;
  listResult?: ListOrganizationAuditResult;
  hasLogoReference?: boolean;
}) {
  const membership =
    options && "membership" in options
      ? options.membership
      : { role: "manager" as const };
  const auditLog =
    options && "auditLog" in options ? options.auditLog : createAuditLog();

  const repository = {
    create: jest.fn(
      async (input: CreateOrganizationAuditLogInput) =>
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

  return {
    repository,
    organizationAccessService,
    service: new OrganizationAuditService(
      repository as never,
      organizationAccessService as never,
    ),
  };
}

describe("OrganizationAuditService", () => {
  it("records audit entries through the repository", async () => {
    const { service, repository } = createService();

    const result = await service.record({
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "organization.created",
      resourceType: "organization",
      summary: "Created organization",
    });

    expect(repository.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
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
        organizationId: "org-1",
        actorUserId: "user-1",
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(listResult);
    expect(organizationAccessService.findMembership).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
    expect(repository.list).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
      page: 1,
      pageSize: 20,
    });
  });

  it("rejects missing organization access when listing audit history", async () => {
    const { service } = createService({ membership: null });

    await expect(
      service.list({
        organizationId: "org-1",
        actorUserId: "user-1",
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects operators from listing audit history", async () => {
    const { service } = createService({ membership: { role: "operator" } });

    await expect(
      service.list({
        organizationId: "org-1",
        actorUserId: "user-1",
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns a restorable audit entry for managers", async () => {
    const auditLog = createAuditLog({ id: "audit-2", restorable: true });
    const { service, repository } = createService({ auditLog });

    await expect(
      service.requireRestorableAudit({
        organizationId: "org-1",
        actorUserId: "user-1",
        auditId: "audit-2",
      }),
    ).resolves.toEqual(auditLog);
    expect(repository.findById).toHaveBeenCalledWith("org-1", "audit-2");
  });

  it("rejects missing audit entries during restore", async () => {
    const { service } = createService({ auditLog: null });

    await expect(
      service.requireRestorableAudit({
        organizationId: "org-1",
        actorUserId: "user-1",
        auditId: "missing-audit",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects non-restorable audit entries during restore", async () => {
    const { service } = createService({
      auditLog: createAuditLog({ restorable: false }),
    });

    await expect(
      service.requireRestorableAudit({
        organizationId: "org-1",
        actorUserId: "user-1",
        auditId: "audit-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("checks whether a managed logo is still referenced by a restorable audit", async () => {
    const { service, repository } = createService({ hasLogoReference: true });

    await expect(
      service.hasRestorableOrganizationLogoReference({
        organizationId: "org-1",
        blobName: "organizations/org-1/logo.png",
      }),
    ).resolves.toBe(true);
    expect(
      repository.hasRestorableOrganizationLogoReference,
    ).toHaveBeenCalledWith({
      organizationId: "org-1",
      blobName: "organizations/org-1/logo.png",
    });
  });
});
