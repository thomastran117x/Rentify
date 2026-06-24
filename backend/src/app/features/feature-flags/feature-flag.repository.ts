import type { FeatureFlag, FeatureFlagAuditLog } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  CreateAuditLogInput,
  FeatureFlagRecord,
} from "@/features/feature-flags/feature-flag.model";

export class FeatureFlagRepository extends BaseRepository {
  async findByName(name: string): Promise<FeatureFlagRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.featureFlag.findUnique({ where: { name } }),
    );
    return row ? this.mapFlag(row) : null;
  }

  async listAll(): Promise<FeatureFlagRecord[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.featureFlag.findMany({ orderBy: { name: "asc" } }),
    );
    return rows.map((row) => this.mapFlag(row));
  }

  async upsert(
    name: string,
    enabled: boolean,
    description?: string | null,
    createdByUserId?: string | null,
    updatedByUserId?: string | null,
  ): Promise<FeatureFlagRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.featureFlag.upsert({
        where: { name },
        create: {
          name,
          enabled,
          description: description ?? null,
          createdByUserId: createdByUserId ?? null,
          updatedByUserId: updatedByUserId ?? null,
        },
        update: {
          enabled,
          description: description ?? null,
          updatedByUserId: updatedByUserId ?? null,
        },
      }),
    );
    return this.mapFlag(row);
  }

  async deleteByName(name: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.featureFlag.delete({ where: { name } }),
    );
  }

  async createAuditLog(entry: CreateAuditLogInput): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.featureFlagAuditLog.create({
        data: {
          flagName: entry.flagName,
          action: entry.action,
          oldEnabled: entry.oldEnabled ?? null,
          newEnabled: entry.newEnabled ?? null,
          oldDescription: entry.oldDescription ?? null,
          newDescription: entry.newDescription ?? null,
          actorUserId: entry.actorUserId ?? null,
        },
      }),
    );
  }

  private mapFlag(row: FeatureFlag): FeatureFlagRecord {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      description: row.description,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
