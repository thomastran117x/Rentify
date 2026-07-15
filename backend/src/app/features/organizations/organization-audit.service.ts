import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { OrganizationAuditRepository } from "@/features/organizations/organization-audit.repository";
import type {
  CreateOrganizationAuditLogInput,
  ListOrganizationAuditInput,
  ListOrganizationAuditResult,
  OrganizationAuditRecord,
  RestoreOrganizationVersionInput,
} from "@/features/organizations/organization-audit.model";

export class OrganizationAuditService {
  constructor(
    private readonly repository: OrganizationAuditRepository,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  async record(
    input: CreateOrganizationAuditLogInput,
  ): Promise<OrganizationAuditRecord> {
    return this.repository.create(input);
  }

  async list(
    input: ListOrganizationAuditInput,
  ): Promise<ListOrganizationAuditResult> {
    await this.requireManager(input.actorUserId, input.organizationId);
    return this.repository.list(input);
  }

  async requireRestorableAudit(
    input: RestoreOrganizationVersionInput,
  ): Promise<OrganizationAuditRecord> {
    await this.requireManager(input.actorUserId, input.organizationId);
    const auditLog = await this.repository.findById(
      input.organizationId,
      input.auditId,
    );

    if (!auditLog) {
      throw new ResourceNotFoundError(
        "Organization audit entry could not be found.",
      );
    }

    if (!auditLog.restorable) {
      throw new ConflictError("This audit entry cannot be restored.");
    }

    return auditLog;
  }

  private async requireManager(
    actorUserId: string,
    organizationId: string,
  ): Promise<void> {
    const membership = await this.organizationAccessService.findMembership(
      actorUserId,
      organizationId,
    );

    if (!membership) {
      throw new ResourceNotFoundError("Organization could not be found.");
    }

    if (
      membership.role !== "primary_manager" &&
      membership.role !== "manager"
    ) {
      throw new ForbiddenError(
        "Only organization managers can view audit history.",
      );
    }
  }
}
