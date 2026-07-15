import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  CreateOrganizationAuditLogInput,
  ListOrganizationAuditInput,
  ListOrganizationAuditResult,
  OrganizationAuditChange,
  OrganizationAuditRecord,
  OrganizationAuditResourceType,
} from "@/features/organizations/organization-audit.model";

type AuditLogPersistence = Prisma.OrganizationAuditLogGetPayload<{
  include: {
    actor: {
      include: {
        profile: true;
      };
    };
  };
}>;

export class OrganizationAuditRepository extends BaseRepository {
  async create(
    input: CreateOrganizationAuditLogInput,
  ): Promise<OrganizationAuditRecord> {
    const row = await this.executeTransaction(async (transaction) => {
      const [orgVersion, resourceVersion] = await Promise.all([
        transaction.organizationAuditLog.aggregate({
          where: { organizationId: input.organizationId },
          _max: { organizationVersion: true },
        }),
        input.resourceId
          ? transaction.organizationAuditLog.aggregate({
              where: {
                organizationId: input.organizationId,
                resourceType: input.resourceType,
                resourceId: input.resourceId,
              },
              _max: { resourceVersion: true },
            })
          : Promise.resolve({ _max: { resourceVersion: null } }),
      ]);

      return transaction.organizationAuditLog.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          organizationVersion:
            (orgVersion._max.organizationVersion ?? 0) + 1,
          resourceVersion: input.resourceId
            ? (resourceVersion._max.resourceVersion ?? 0) + 1
            : null,
          summary: input.summary,
          changes: this.toJson(input.changes ?? []),
          beforeSnapshot: this.toJson(input.beforeSnapshot),
          afterSnapshot: this.toJson(input.afterSnapshot),
          restorable: input.restorable ?? false,
          restoredFromAuditId: input.restoredFromAuditId ?? null,
        },
        include: this.includeActor(),
      });
    });

    return this.mapAuditLog(row);
  }

  async list(
    input: ListOrganizationAuditInput,
  ): Promise<ListOrganizationAuditResult> {
    const where: Prisma.OrganizationAuditLogWhereInput = {
      organizationId: input.organizationId,
      ...(input.action ? { action: input.action } : {}),
      ...(input.resourceType ? { resourceType: input.resourceType } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.organizationAuditLog.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: { createdAt: "desc" },
          include: this.includeActor(),
        }),
        this.prisma.organizationAuditLog.count({ where }),
      ]),
    );

    return {
      auditLogs: rows.map((row) => this.mapAuditLog(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
    };
  }

  async findById(
    organizationId: string,
    auditId: string,
  ): Promise<OrganizationAuditRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationAuditLog.findFirst({
        where: { id: auditId, organizationId },
        include: this.includeActor(),
      }),
    );

    return row ? this.mapAuditLog(row) : null;
  }

  private includeActor() {
    return {
      actor: {
        include: {
          profile: true,
        },
      },
    } satisfies Prisma.OrganizationAuditLogInclude;
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private mapAuditLog(row: AuditLogPersistence): OrganizationAuditRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      actor: row.actor
        ? {
            id: row.actor.id,
            email: row.actor.email,
            username: row.actor.profile?.username ?? row.actor.email,
            avatarUrl: row.actor.profile?.avatarUrl ?? undefined,
          }
        : undefined,
      action: row.action as OrganizationAuditRecord["action"],
      resourceType: row.resourceType as OrganizationAuditResourceType,
      resourceId: row.resourceId ?? undefined,
      organizationVersion: row.organizationVersion,
      resourceVersion: row.resourceVersion ?? undefined,
      summary: row.summary,
      changes: this.mapChanges(row.changes),
      beforeSnapshot: row.beforeSnapshot ?? undefined,
      afterSnapshot: row.afterSnapshot ?? undefined,
      restorable: row.restorable,
      restoredFromAuditId: row.restoredFromAuditId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapChanges(value: Prisma.JsonValue | null): OrganizationAuditChange[] {
    return Array.isArray(value)
      ? (value as unknown as OrganizationAuditChange[])
      : [];
  }

  private createPagination(page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
