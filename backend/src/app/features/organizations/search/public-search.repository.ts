import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  ListPublicOrganizationsInput,
  PublicOrganizationDetailResult,
  PublicOrganizationProfileFields,
  PublicOrganizationSummary,
} from "@/features/organizations/profile/profile.model";

type PublicOrganizationRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  customFields: Prisma.JsonValue | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedPostingCount: bigint | number;
};

type CountRow = {
  total: bigint | number;
};

interface SearchIdRow {
  id: string;
}

export class OrganizationsPublicSearchRepository extends BaseRepository {
  private parseCustomFields(
    value: Prisma.JsonValue | null,
  ): Record<string, string> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") {
        result[key] = entry;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  private mapPublicOrganizationProfileFields(
    organization: Pick<
      PublicOrganizationRow,
      | "description"
      | "websiteUrl"
      | "addressLine1"
      | "addressLine2"
      | "city"
      | "region"
      | "country"
      | "postalCode"
      | "logoUrl"
      | "customFields"
    >,
  ): PublicOrganizationProfileFields {
    return {
      description: organization.description,
      websiteUrl: organization.websiteUrl,
      addressLine1: organization.addressLine1,
      addressLine2: organization.addressLine2,
      city: organization.city,
      region: organization.region,
      country: organization.country,
      postalCode: organization.postalCode,
      logoUrl: organization.logoUrl,
      customFields: this.parseCustomFields(organization.customFields),
    };
  }

  private mapPublicOrganization(
    organization: PublicOrganizationRow,
  ): PublicOrganizationDetailResult["organization"] {
    return {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      createdAt: new Date(organization.createdAt).toISOString(),
      updatedAt: new Date(organization.updatedAt).toISOString(),
      publishedPostingCount: this.readNumberLike(
        organization.publishedPostingCount,
      ),
      ...this.mapPublicOrganizationProfileFields(organization),
    };
  }

  private readNumberLike(value: bigint | number | null | undefined): number {
    if (typeof value === "bigint") {
      return Number(value);
    }

    return typeof value === "number" ? value : 0;
  }

  private createLikePattern(query: string): string {
    const escaped = query
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    return `%${escaped}%`;
  }

  private createFallbackOrderBy(
    sort: ListPublicOrganizationsInput["sort"],
  ): Prisma.Sql {
    switch (sort) {
      case "nameDesc":
        return Prisma.sql`LOWER(o.name) DESC, o.created_at DESC, o.id ASC`;
      case "newest":
        return Prisma.sql`o.created_at DESC, o.id ASC`;
      case "oldest":
        return Prisma.sql`o.created_at ASC, o.id ASC`;
      case "nameAsc":
      case "relevance":
      default:
        return Prisma.sql`LOWER(o.name) ASC, o.created_at DESC, o.id ASC`;
    }
  }

  // Database fallback for the public directory. Returns only ordered ids + the
  // total count; the caller hydrates the display rows via batchFindPublicByIds.
  // Matches on name (case-insensitive substring) like the historical query, and
  // now surfaces every organization regardless of published postings.
  async searchPublicFallback(
    input: ListPublicOrganizationsInput,
  ): Promise<{ ids: string[]; total: number }> {
    const whereSql = input.query
      ? Prisma.sql`WHERE LOWER(o.name) LIKE ${this.createLikePattern(input.query)} ESCAPE '\\\\'`
      : Prisma.empty;
    const offset = (input.page - 1) * input.pageSize;
    const orderBySql = this.createFallbackOrderBy(input.sort);

    const [rows, countRows] = await Promise.all([
      this.executeAsync(() =>
        this.prisma.$queryRaw<SearchIdRow[]>(Prisma.sql`
          SELECT o.id AS id
          FROM organizations o
          ${whereSql}
          ORDER BY ${orderBySql}
          LIMIT ${input.pageSize}
          OFFSET ${offset}
        `),
      ),
      this.executeAsync(() =>
        this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS total
          FROM organizations o
          ${whereSql}
        `),
      ),
    ]);

    return {
      ids: rows.map((row) => row.id),
      total: this.readNumberLike(countRows[0]?.total),
    };
  }

  // Hydrate the public display rows (including a live published-posting count)
  // for the given ids, preserving the order in which they were provided.
  async batchFindPublicByIds(
    ids: string[],
  ): Promise<
    Array<PublicOrganizationSummary & PublicOrganizationProfileFields>
  > {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.$queryRaw<PublicOrganizationRow[]>(Prisma.sql`
        SELECT
          o.id AS id,
          o.slug AS slug,
          o.name AS name,
          o.description AS description,
          o.website_url AS websiteUrl,
          o.address_line1 AS addressLine1,
          o.address_line2 AS addressLine2,
          o.city AS city,
          o.region AS region,
          o.country AS country,
          o.postal_code AS postalCode,
          o.logo_url AS logoUrl,
          o.custom_fields AS customFields,
          o.created_at AS createdAt,
          o.updated_at AS updatedAt,
          COUNT(p.id) AS publishedPostingCount
        FROM organizations o
        LEFT JOIN postings p
          ON p.organization_id = o.id
          AND p.status = 'published'
        WHERE o.id IN (${Prisma.join(ids)})
        GROUP BY
          o.id,
          o.slug,
          o.name,
          o.description,
          o.website_url,
          o.address_line1,
          o.address_line2,
          o.city,
          o.region,
          o.country,
          o.postal_code,
          o.logo_url,
          o.custom_fields,
          o.created_at,
          o.updated_at
      `),
    );

    const byId = new Map(
      rows.map((row) => [row.id, this.mapPublicOrganization(row)]),
    );

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }
}
