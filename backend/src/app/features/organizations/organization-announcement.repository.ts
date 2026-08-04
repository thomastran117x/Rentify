import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  CreateOrganizationAnnouncementPersistence,
  ListOrganizationAnnouncementsInput,
  ListOrganizationAnnouncementsResult,
  OrganizationAnnouncementRecord,
  OrganizationAnnouncementStatus,
  UpdateOrganizationAnnouncementPersistence,
} from "@/features/organizations/organization-announcement.model";

type AnnouncementPersistence = Prisma.OrganizationAnnouncementGetPayload<{
  include: {
    author: {
      include: {
        profile: true;
      };
    };
  };
}>;

export interface ListOrganizationAnnouncementsQueryInput
  extends ListOrganizationAnnouncementsInput {
  statuses?: OrganizationAnnouncementStatus[];
}

export class OrganizationAnnouncementRepository extends BaseRepository {
  async create(
    input: CreateOrganizationAnnouncementPersistence,
  ): Promise<OrganizationAnnouncementRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationAnnouncement.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          authorUserId: input.authorUserId,
          title: input.title,
          body: input.body,
          status: input.status,
          publishedAt: input.publishedAt,
        },
        include: this.includeAuthor(),
      }),
    );

    return this.mapAnnouncement(row);
  }

  async update(
    organizationId: string,
    announcementId: string,
    input: UpdateOrganizationAnnouncementPersistence,
  ): Promise<OrganizationAnnouncementRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationAnnouncement.update({
        where: { id: announcementId, organizationId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.publishedAt !== undefined
            ? { publishedAt: input.publishedAt }
            : {}),
        },
        include: this.includeAuthor(),
      }),
    );

    return this.mapAnnouncement(row);
  }

  async delete(organizationId: string, announcementId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationAnnouncement.delete({
        where: { id: announcementId, organizationId },
      }),
    );
  }

  async findById(
    organizationId: string,
    announcementId: string,
  ): Promise<OrganizationAnnouncementRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationAnnouncement.findFirst({
        where: { id: announcementId, organizationId },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapAnnouncement(row) : null;
  }

  async list(
    input: ListOrganizationAnnouncementsQueryInput,
  ): Promise<ListOrganizationAnnouncementsResult> {
    const statusFilter = input.status
      ? [input.status]
      : (input.statuses ?? undefined);
    const where: Prisma.OrganizationAnnouncementWhereInput = {
      organizationId: input.organizationId,
      ...(statusFilter ? { status: { in: statusFilter } } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.organizationAnnouncement.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: { createdAt: "desc" },
          include: this.includeAuthor(),
        }),
        this.prisma.organizationAnnouncement.count({ where }),
      ]),
    );

    return {
      announcements: rows.map((row) => this.mapAnnouncement(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
    };
  }

  private includeAuthor() {
    return {
      author: {
        include: {
          profile: true,
        },
      },
    } satisfies Prisma.OrganizationAnnouncementInclude;
  }

  private mapAnnouncement(
    row: AnnouncementPersistence,
  ): OrganizationAnnouncementRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      author: row.author
        ? {
            id: row.author.id,
            email: row.author.email,
            username: row.author.profile?.username ?? row.author.email,
            avatarUrl: row.author.profile?.avatarUrl ?? undefined,
          }
        : undefined,
      title: row.title,
      body: row.body,
      status: row.status as OrganizationAnnouncementStatus,
      publishedAt: row.publishedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
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
