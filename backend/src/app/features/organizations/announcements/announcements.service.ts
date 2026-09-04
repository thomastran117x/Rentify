import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { loggerFactory } from "@/configuration/logging";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationAnnouncementRepository } from "@/features/organizations/announcements/announcements.repository";
import type {
  CreateOrganizationAnnouncementInput,
  DeleteOrganizationAnnouncementInput,
  DeleteOrganizationAnnouncementResult,
  ListOrganizationAnnouncementsInput,
  ListOrganizationAnnouncementsResult,
  OrganizationAnnouncementRecord,
  UpdateOrganizationAnnouncementInput,
} from "@/features/organizations/announcements/announcements.model";
import type { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import {
  createAuditChanges,
  type CreateOrganizationAuditLogInput,
  type OrganizationAuditAction,
} from "@/features/organizations/audit/audit.model";
import type { Uuid } from "@/configuration/validation/uuid";

export class OrganizationAnnouncementService {
  private readonly logger = loggerFactory.forClass(
    OrganizationAnnouncementService,
    "service",
  );

  constructor(
    private readonly repository: OrganizationAnnouncementRepository,
    private readonly organizationAccessService: OrganizationAccessService,
    private readonly organizationAuditService: OrganizationAuditService,
  ) {}

  async list(
    input: ListOrganizationAnnouncementsInput,
  ): Promise<ListOrganizationAnnouncementsResult> {
    const canManage = await this.resolveCanManage(
      input.actorUserId,
      input.organizationId,
    );

    return this.repository.list({
      ...input,
      ...(canManage ? {} : { statuses: ["published"] }),
    });
  }

  async create(
    input: CreateOrganizationAnnouncementInput,
  ): Promise<OrganizationAnnouncementRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);

    const announcement = await this.repository.create({
      organizationId: input.organizationId,
      authorUserId: input.actorUserId,
      title: input.title,
      body: input.body,
      status: input.status,
      publishedAt: input.status === "published" ? new Date() : null,
    });

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "announcement.created",
      resourceType: "announcement",
      resourceId: announcement.id,
      summary: `Created announcement "${announcement.title}".`,
      afterSnapshot: this.toSnapshot(announcement),
    });

    return announcement;
  }

  async update(
    input: UpdateOrganizationAnnouncementInput,
  ): Promise<OrganizationAnnouncementRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const existing = await this.requireAnnouncement(
      input.organizationId,
      input.announcementId,
    );

    const nextStatus = input.status ?? existing.status;
    const publishedAt =
      nextStatus === existing.status
        ? undefined
        : nextStatus === "published"
          ? new Date()
          : null;

    const updated = await this.repository.update(
      input.organizationId,
      input.announcementId,
      {
        title: input.title,
        body: input.body,
        status: input.status,
        publishedAt,
      },
    );

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: this.resolveUpdateAction(existing.status, updated.status),
      resourceType: "announcement",
      resourceId: updated.id,
      summary: `Updated announcement "${updated.title}".`,
      changes: createAuditChanges(
        this.toSnapshot(existing),
        this.toSnapshot(updated),
      ),
      beforeSnapshot: this.toSnapshot(existing),
      afterSnapshot: this.toSnapshot(updated),
    });

    return updated;
  }

  async delete(
    input: DeleteOrganizationAnnouncementInput,
  ): Promise<DeleteOrganizationAnnouncementResult> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const existing = await this.requireAnnouncement(
      input.organizationId,
      input.announcementId,
    );

    await this.repository.delete(input.organizationId, input.announcementId);

    await this.recordAuditSafely({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "announcement.deleted",
      resourceType: "announcement",
      resourceId: existing.id,
      summary: `Deleted announcement "${existing.title}".`,
      beforeSnapshot: this.toSnapshot(existing),
    });

    return { deleted: true, announcementId: input.announcementId };
  }

  private resolveUpdateAction(
    previousStatus: OrganizationAnnouncementRecord["status"],
    nextStatus: OrganizationAnnouncementRecord["status"],
  ): OrganizationAuditAction {
    if (previousStatus !== nextStatus && nextStatus === "published") {
      return "announcement.published";
    }

    if (previousStatus !== nextStatus && nextStatus === "draft") {
      return "announcement.unpublished";
    }

    return "announcement.updated";
  }

  private toSnapshot(
    announcement: OrganizationAnnouncementRecord,
  ): Record<string, unknown> {
    return {
      title: announcement.title,
      body: announcement.body,
      status: announcement.status,
      publishedAt: announcement.publishedAt ?? null,
    };
  }

  private async requireAnnouncement(
    organizationId: Uuid,
    announcementId: Uuid,
  ): Promise<OrganizationAnnouncementRecord> {
    const announcement = await this.repository.findById(
      organizationId,
      announcementId,
    );

    if (!announcement) {
      throw new ResourceNotFoundError(
        "Organization announcement could not be found.",
      );
    }

    return announcement;
  }

  private async resolveCanManage(
    actorUserId: Uuid,
    organizationId: Uuid,
  ): Promise<boolean> {
    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    return this.organizationAccessService.canManage(membership.role);
  }

  private async requireManager(
    actorUserId: Uuid,
    organizationId: Uuid,
  ): Promise<void> {
    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (!this.organizationAccessService.canManage(membership.role)) {
      throw new ForbiddenError(
        "Only organization managers can manage announcements.",
      );
    }
  }

  private async recordAuditSafely(
    input: CreateOrganizationAuditLogInput,
  ): Promise<void> {
    try {
      await this.organizationAuditService.record(input);
    } catch (error) {
      this.logger.error("Failed to record organization audit entry.", {
        organizationId: input.organizationId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? undefined,
        error,
      });
    }
  }
}
