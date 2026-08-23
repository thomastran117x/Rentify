import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationAnnouncementService } from "@/features/organizations/announcements/announcements.service";
import type {
  ListOrganizationAnnouncementsResult,
  OrganizationAnnouncementRecord,
} from "@/features/organizations/announcements/announcements.model";

type Role = "primary_manager" | "manager" | "operator";

function createAnnouncement(
  overrides: Partial<OrganizationAnnouncementRecord> = {},
): OrganizationAnnouncementRecord {
  return {
    id: "announcement-1",
    organizationId: "org-1",
    title: "Announcement title",
    body: "Announcement body",
    status: "draft",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function createListResult(): ListOrganizationAnnouncementsResult {
  return {
    announcements: [createAnnouncement({ status: "published" })],
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
  membership?: { role: Role } | null;
  existing?: OrganizationAnnouncementRecord | null;
}) {
  const membership =
    options && "membership" in options
      ? options.membership
      : { role: "manager" as const };
  const existing =
    options && "existing" in options
      ? options.existing
      : createAnnouncement({ status: "draft" });

  const repository = {
    create: jest.fn(async (input: Record<string, unknown>) =>
      createAnnouncement({
        title: input.title as string,
        body: input.body as string,
        status: input.status as OrganizationAnnouncementRecord["status"],
        publishedAt:
          (input.publishedAt as Date | null)?.toISOString() ?? undefined,
      }),
    ),
    update: jest.fn(async (_orgId, _id, input: Record<string, unknown>) =>
      createAnnouncement({
        ...(existing ?? {}),
        title: (input.title as string) ?? existing?.title ?? "Announcement",
        body: (input.body as string) ?? existing?.body ?? "Body",
        status:
          (input.status as OrganizationAnnouncementRecord["status"]) ??
          existing?.status ??
          "draft",
      }),
    ),
    delete: jest.fn(async () => undefined),
    findById: jest.fn(async () => existing),
    list: jest.fn(async (_input: Record<string, unknown>) =>
      createListResult(),
    ),
  };
  const organizationAccessService = {
    findMembership: jest.fn(async () => membership),
    canManage: jest.fn(
      (role: Role) => role === "primary_manager" || role === "manager",
    ),
  };
  const organizationAuditService = {
    record: jest.fn(async () => createAnnouncement()),
  };

  return {
    repository,
    organizationAccessService,
    organizationAuditService,
    service: new OrganizationAnnouncementService(
      repository as never,
      organizationAccessService as never,
      organizationAuditService as never,
    ),
  };
}

describe("OrganizationAnnouncementService", () => {
  it("lists all announcements for managers", async () => {
    const { service, repository } = createService({
      membership: { role: "primary_manager" },
    });

    await service.list({
      organizationId: "org-1",
      actorUserId: "user-1",
      page: 1,
      pageSize: 20,
    });

    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
    );
    const listArgs = repository.list.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(listArgs.statuses).toBeUndefined();
  });

  it("restricts operators to published announcements", async () => {
    const { service, repository } = createService({
      membership: { role: "operator" },
    });

    await service.list({
      organizationId: "org-1",
      actorUserId: "user-1",
      page: 1,
      pageSize: 20,
    });

    const listArgs = repository.list.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(listArgs.statuses).toEqual(["published"]);
  });

  it("rejects non-members when listing announcements", async () => {
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

  it("creates announcements for managers and records an audit entry", async () => {
    const { service, repository, organizationAuditService } = createService();

    const result = await service.create({
      organizationId: "org-1",
      actorUserId: "user-1",
      title: "New announcement",
      body: "Body text",
      status: "published",
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        authorUserId: "user-1",
        status: "published",
      }),
    );
    expect(result.status).toBe("published");
    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "announcement.created",
        resourceType: "announcement",
      }),
    );
  });

  it("rejects operators from creating announcements", async () => {
    const { service } = createService({ membership: { role: "operator" } });

    await expect(
      service.create({
        organizationId: "org-1",
        actorUserId: "user-1",
        title: "New announcement",
        body: "Body text",
        status: "draft",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records a publish action when a draft transitions to published", async () => {
    const { service, organizationAuditService } = createService({
      existing: createAnnouncement({ status: "draft" }),
    });

    await service.update({
      organizationId: "org-1",
      actorUserId: "user-1",
      announcementId: "announcement-1",
      status: "published",
    });

    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "announcement.published" }),
    );
  });

  it("records an unpublished action when a published announcement reverts to draft", async () => {
    const { service, organizationAuditService } = createService({
      existing: createAnnouncement({ status: "published" }),
    });

    await service.update({
      organizationId: "org-1",
      actorUserId: "user-1",
      announcementId: "announcement-1",
      status: "draft",
    });

    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "announcement.unpublished" }),
    );
  });

  it("records a generic update action when status is unchanged", async () => {
    const { service, organizationAuditService } = createService({
      existing: createAnnouncement({ status: "draft" }),
    });

    await service.update({
      organizationId: "org-1",
      actorUserId: "user-1",
      announcementId: "announcement-1",
      title: "Updated title",
    });

    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "announcement.updated" }),
    );
  });

  it("rejects updates for missing announcements", async () => {
    const { service } = createService({ existing: null });

    await expect(
      service.update({
        organizationId: "org-1",
        actorUserId: "user-1",
        announcementId: "missing",
        title: "Updated title",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("deletes announcements for managers and records an audit entry", async () => {
    const { service, repository, organizationAuditService } = createService();

    const result = await service.delete({
      organizationId: "org-1",
      actorUserId: "user-1",
      announcementId: "announcement-1",
    });

    expect(repository.delete).toHaveBeenCalledWith("org-1", "announcement-1");
    expect(result).toEqual({
      deleted: true,
      announcementId: "announcement-1",
    });
    expect(organizationAuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "announcement.deleted" }),
    );
  });

  it("rejects operators from deleting announcements", async () => {
    const { service } = createService({ membership: { role: "operator" } });

    await expect(
      service.delete({
        organizationId: "org-1",
        actorUserId: "user-1",
        announcementId: "announcement-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
