import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  maskEmailAddress,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationMembershipSummary,
  type OrganizationProfileFields,
  type OrganizationProfileInput,
  type OrganizationSummary,
  type ResolvedOrganizationReference,
} from "@/features/organizations/organizations.model";
import type {
  ListPublicOrganizationsInput,
  OrganizationWorkspaceDetailResult,
  PublicOrganizationDetailResult,
  PublicOrganizationListResult,
  PublicOrganizationProfileFields,
} from "@/features/organizations/profile/profile.model";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

type MembershipPersistence = Prisma.OrganizationMembershipGetPayload<{
  include: {
    user: {
      include: {
        profile: true;
      };
    };
  };
}>;

type MembershipWithOrganizationPersistence =
  Prisma.OrganizationMembershipGetPayload<{
    include: {
      organization: true;
      user: {
        include: {
          profile: true;
        };
      };
    };
  }>;

type InvitationPersistence = Prisma.OrganizationInvitationGetPayload<{
  include: {
    invitedByUser: {
      include: {
        profile: true;
      };
    };
    acceptedByUser: {
      include: {
        profile: true;
      };
    };
  };
}>;

/**
 * A slug is already spoken for -- as some organization's current slug, or as one
 * it has retired.
 *
 * Callers generating a slug should move to the next candidate; callers honouring
 * an explicit choice should surface a conflict to the user.
 */
export class OrganizationSlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`Organization slug "${slug}" is already reserved.`);
    this.name = "OrganizationSlugTakenError";
  }
}

/**
 * Translate a unique-constraint violation on either slug key into the typed
 * error. Anything else is genuinely unexpected and passes through untouched.
 */
function toOrganizationSlugTakenError(error: unknown, slug: string): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new OrganizationSlugTakenError(slug);
  }

  return error;
}

type OrganizationProfilePersistence = {
  description: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  logoBlobName: string | null;
  customFields: Prisma.JsonValue | null;
};

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

interface OrganizationNameMatchRow {
  id: string;
  name: string;
  slug: string;
}

export class OrganizationsProfileRepository extends BaseRepository {
  private mapOrganizationProfileFields(
    organization: OrganizationProfilePersistence,
  ): OrganizationProfileFields {
    return {
      description: organization.description,
      websiteUrl: organization.websiteUrl,
      contactEmail: organization.contactEmail,
      contactPhone: organization.contactPhone,
      addressLine1: organization.addressLine1,
      addressLine2: organization.addressLine2,
      city: organization.city,
      region: organization.region,
      country: organization.country,
      postalCode: organization.postalCode,
      logoUrl: organization.logoUrl,
      logoBlobName: organization.logoBlobName,
      customFields: this.parseCustomFields(organization.customFields),
    };
  }

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

  private buildOrganizationWriteData(
    input: OrganizationProfileInput,
  ): Prisma.OrganizationUncheckedUpdateInput {
    const data: Prisma.OrganizationUncheckedUpdateInput = {};
    const textFields = [
      "description",
      "websiteUrl",
      "contactEmail",
      "contactPhone",
      "addressLine1",
      "addressLine2",
      "city",
      "region",
      "country",
      "postalCode",
      "logoUrl",
      "logoBlobName",
    ] as const;
    for (const field of textFields) {
      const value = input[field];
      if (value !== undefined) {
        data[field] = value;
      }
    }
    if (input.customFields !== undefined) {
      data.customFields =
        input.customFields === null ||
        Object.keys(input.customFields).length === 0
          ? Prisma.DbNull
          : (input.customFields as Prisma.InputJsonValue);
    }
    return data;
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
      id: asUuid(organization.id),
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

  /**
   * Resolve an organization name typed by a searcher into concrete ids so that
   * posting search can filter on ids in both Elasticsearch and the SQL
   * fallback. Exact matches rank first, then prefix, then substring.
   *
   * Fetches one row beyond `limit` so the caller can tell the UI that more
   * organizations matched than were applied to the filter.
   */
  async findOrganizationNameMatches(
    query: string,
    limit: number,
  ): Promise<{ matches: OrganizationNameMatchRow[]; truncated: boolean }> {
    const normalized = query.trim().toLowerCase();

    if (!normalized || limit < 1) {
      return { matches: [], truncated: false };
    }

    const escaped = normalized.replace(/[\\%_]/g, "\\$&");
    const containsPattern = `%${escaped}%`;
    const prefixPattern = `${escaped}%`;

    const rows = await this.executeAsync(() =>
      this.prisma.$queryRaw<OrganizationNameMatchRow[]>(Prisma.sql`
        SELECT o.id AS id, o.name AS name, o.slug AS slug
        FROM organizations o
        WHERE LOWER(o.name) LIKE ${containsPattern} ESCAPE '\\\\'
        ORDER BY
          CASE
            WHEN LOWER(o.name) = ${normalized} THEN 0
            WHEN LOWER(o.name) LIKE ${prefixPattern} ESCAPE '\\\\' THEN 1
            ELSE 2
          END ASC,
          o.name ASC,
          o.id ASC
        LIMIT ${limit + 1}
      `),
    );

    return {
      matches: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
  }

  /**
   * Minimal id/name/slug lookup for posting search. Deliberately not
   * batchFindPublicByIds, which carries a published-posting-count aggregation
   * that would be wasted work on every search request.
   */
  async findOrganizationSummariesByIds(
    ids: string[],
  ): Promise<OrganizationNameMatchRow[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.executeAsync(() =>
      this.prisma.organization.findMany({
        where: {
          id: {
            in: ids,
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      }),
    );
  }

  async listPublicOrganizations(
    input: ListPublicOrganizationsInput,
  ): Promise<PublicOrganizationListResult> {
    const whereSql = input.query
      ? Prisma.sql`WHERE LOWER(o.name) LIKE ${this.createLikePattern(input.query)} ESCAPE '\\\\'`
      : Prisma.empty;
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRows] = await Promise.all([
      this.executeAsync(() =>
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
          ${whereSql}
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
          ORDER BY LOWER(o.name) ASC, o.created_at DESC, o.id ASC
          LIMIT ${input.pageSize}
          OFFSET ${offset}
        `),
      ),
      this.executeAsync(() =>
        this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS total
          FROM (
            SELECT o.id
            FROM organizations o
            LEFT JOIN postings p
              ON p.organization_id = o.id
              AND p.status = 'published'
            ${whereSql}
            GROUP BY o.id
          ) visible_organizations
        `),
      ),
    ]);

    const total = this.readNumberLike(countRows[0]?.total);
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize));

    return {
      organizations: rows.map((row) => this.mapPublicOrganization(row)),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages,
        hasNextPage: input.page < totalPages,
        hasPreviousPage: input.page > 1,
      },
      ...(input.query ? { query: input.query } : {}),
    };
  }

  async findPublicOrganizationDetail(
    organizationId: Uuid,
  ): Promise<PublicOrganizationDetailResult | null> {
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
        WHERE o.id = ${organizationId}
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
        ORDER BY LOWER(o.name) ASC, o.created_at DESC, o.id ASC
      `),
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      organization: this.mapPublicOrganization(row),
      stats: {
        publishedPostingCount: this.readNumberLike(row.publishedPostingCount),
      },
    };
  }

  async findOrganizationDetail(
    organizationId: Uuid,
  ): Promise<OrganizationWorkspaceDetailResult | null> {
    const organization = await this.executeAsync(() =>
      this.prisma.organization.findUnique({
        where: {
          id: organizationId,
        },
        include: {
          memberships: {
            include: {
              user: {
                include: {
                  profile: true,
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          invitations: {
            where: {
              status: "pending",
            },
            include: {
              invitedByUser: {
                include: {
                  profile: true,
                },
              },
              acceptedByUser: {
                include: {
                  profile: true,
                },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      }),
    );

    if (!organization) {
      return null;
    }

    return {
      organization: {
        id: asUuid(organization.id),
        slug: organization.slug,
        name: organization.name,
        createdAt: organization.createdAt.toISOString(),
        updatedAt: organization.updatedAt.toISOString(),
        ...this.mapOrganizationProfileFields(organization),
      },
      viewerRole: "operator",
      members: organization.memberships.map((membership) =>
        this.mapMemberRecord(membership),
      ),
      invitations: organization.invitations.map((invitation) =>
        this.mapInvitationRecord(invitation),
      ),
    };
  }

  /**
   * Map a slug onto an organization, following retired slugs.
   *
   * The current slug is checked first. Reservations cover every slug an
   * organization has ever held, so a hit there that is not the current slug is
   * by definition a retired one.
   */
  async resolveBySlug(
    slug: string,
  ): Promise<ResolvedOrganizationReference | null> {
    const organization = await this.executeAsync(() =>
      this.prisma.organization.findUnique({
        where: {
          slug,
        },
        select: {
          id: true,
          slug: true,
          name: true,
        },
      }),
    );

    if (organization) {
      return {
        organizationId: asUuid(organization.id),
        canonicalSlug: organization.slug,
        name: organization.name,
        matchedBy: "canonical-slug",
      };
    }

    const reservation = await this.executeAsync(() =>
      this.prisma.organizationSlugReservation.findUnique({
        where: {
          slug,
        },
        select: {
          organization: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      }),
    );

    if (!reservation) {
      return null;
    }

    return {
      organizationId: asUuid(reservation.organization.id),
      canonicalSlug: reservation.organization.slug,
      name: reservation.organization.name,
      matchedBy: "alias",
    };
  }

  /**
   * Claim a new slug and retire the current one, atomically.
   *
   * The reservation is inserted first and deliberately: its primary key is the
   * authority on who owns a slug, and unlike a preceding read it is evaluated
   * against current data. The previous slug keeps its own reservation, which is
   * what makes it resolve as a retired slug forever and never be re-adopted.
   *
   * A caller racing us sees an OrganizationSlugTakenError rather than silently
   * overwriting the other claim.
   */
  async changeOrganizationSlug(input: {
    organizationId: Uuid;
    nextSlug: string;
  }): Promise<OrganizationSummary & OrganizationProfileFields> {
    const organization = await this.executeTransaction(async (transaction) => {
      try {
        await transaction.organizationSlugReservation.create({
          data: {
            slug: input.nextSlug,
            organizationId: input.organizationId,
          },
        });
      } catch (error) {
        throw toOrganizationSlugTakenError(error, input.nextSlug);
      }

      let updated;
      try {
        updated = await transaction.organization.update({
          where: {
            id: input.organizationId,
          },
          data: {
            slug: input.nextSlug,
          },
        });
      } catch (error) {
        throw toOrganizationSlugTakenError(error, input.nextSlug);
      }

      await this.enqueueSearchOutbox(
        transaction,
        input.organizationId,
        "upsert",
      );

      return updated;
    });

    return {
      id: asUuid(organization.id),
      slug: organization.slug,
      name: organization.name,
      role: "operator",
      ...this.mapOrganizationProfileFields(organization),
    };
  }

  async setPreferredOrganization(
    userId: Uuid,
    organizationId: string | null,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          preferredOrganizationId: organizationId,
        },
      }),
    );
  }

  async updateOrganization(
    organizationId: Uuid,
    input: OrganizationProfileInput & { name?: string },
  ): Promise<OrganizationSummary & OrganizationProfileFields> {
    const data = this.buildOrganizationWriteData(input);
    if (input.name !== undefined) {
      data.name = input.name;
    }

    const organization = await this.executeTransaction(async (transaction) => {
      const updated = await transaction.organization.update({
        where: {
          id: organizationId,
        },
        data,
      });
      await this.enqueueSearchOutbox(transaction, organizationId, "upsert");
      return updated;
    });

    return {
      id: asUuid(organization.id),
      slug: organization.slug,
      name: organization.name,
      role: "operator",
      ...this.mapOrganizationProfileFields(organization),
    };
  }

  async updateOrganizationName(
    organizationId: Uuid,
    name: string,
  ): Promise<OrganizationSummary & OrganizationProfileFields> {
    return this.updateOrganization(organizationId, { name });
  }

  async createOrganizationWithOwner(
    input: {
      name: string;
      slug: string;
      ownerUserId: Uuid;
    } & OrganizationProfileInput,
  ): Promise<OrganizationMembershipSummary> {
    const { name, slug, ownerUserId, ...profile } = input;
    return this.executeTransaction(async (transaction) => {
      const organizationData: Prisma.OrganizationUncheckedCreateInput = {
        id: newUuid(),
        slug,
        name,
      };
      Object.assign(organizationData, this.buildOrganizationWriteData(profile));

      let organization;
      try {
        organization = await transaction.organization.create({
          data: organizationData,
        });

        // Reserving the slug is what stops a new organization from taking one
        // another organization has retired -- the unique index on
        // organizations.slug cannot see retired slugs at all, so without this a
        // newcomer would quietly inherit the original's old links.
        await transaction.organizationSlugReservation.create({
          data: {
            slug,
            organizationId: organization.id,
          },
        });
      } catch (error) {
        throw toOrganizationSlugTakenError(error, slug);
      }

      await this.enqueueSearchOutbox(
        transaction,
        asUuid(organization.id),
        "upsert",
      );

      const membership = await transaction.organizationMembership.create({
        data: {
          id: newUuid(),
          organizationId: organization.id,
          userId: ownerUserId,
          role: "primary_manager",
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      });

      return this.mapMembershipSummary(membership, organization.id);
    });
  }

  private mapMembershipSummary(
    membership: MembershipWithOrganizationPersistence,
    activeOrganizationId?: string | null,
  ): OrganizationMembershipSummary {
    return {
      membershipId: asUuid(membership.id),
      id: asUuid(membership.organization.id),
      slug: membership.organization.slug,
      name: membership.organization.name,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
      isActive: membership.organization.id === activeOrganizationId,
    };
  }

  private mapMemberRecord(
    membership: MembershipPersistence,
  ): OrganizationMemberRecord {
    return {
      membershipId: asUuid(membership.id),
      userId: asUuid(membership.user.id),
      email: membership.user.email,
      firstName: membership.user.firstName ?? undefined,
      lastName: membership.user.lastName ?? undefined,
      username: membership.user.profile?.username ?? membership.user.email,
      avatarUrl: membership.user.profile?.avatarUrl ?? undefined,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  private mapInvitationRecord(
    invitation: InvitationPersistence,
  ): OrganizationInvitationRecord {
    return {
      id: asUuid(invitation.id),
      email: invitation.email,
      emailHint: maskEmailAddress(invitation.email),
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString(),
      revokedAt: invitation.revokedAt?.toISOString(),
      invitedBy: {
        id: asUuid(invitation.invitedByUser.id),
        email: invitation.invitedByUser.email,
        username:
          invitation.invitedByUser.profile?.username ??
          invitation.invitedByUser.email,
      },
      acceptedBy: invitation.acceptedByUser
        ? {
            id: asUuid(invitation.acceptedByUser.id),
            email: invitation.acceptedByUser.email,
            username:
              invitation.acceptedByUser.profile?.username ??
              invitation.acceptedByUser.email,
          }
        : undefined,
    };
  }

  private async enqueueSearchOutbox(
    transaction: Prisma.TransactionClient,
    organizationId: Uuid,
    operation: "upsert" | "delete",
  ): Promise<void> {
    const activeRun = await transaction.organizationSearchReindexRun.findFirst({
      where: {
        status: {
          in: ["pending", "running", "waiting_for_catchup"],
        },
      },
      orderBy: [
        {
          createdAt: "desc",
        },
      ],
      select: {
        id: true,
        targetIndexName: true,
      },
    });
    const primaryEventId = newUuid();
    const entries: Prisma.OrganizationSearchOutboxCreateManyInput[] = [
      {
        id: primaryEventId,
        organizationId,
        operation,
        dedupeKey: primaryEventId,
      },
    ];

    if (activeRun) {
      const secondaryEventId = newUuid();
      entries.push({
        id: secondaryEventId,
        organizationId,
        reindexRunId: activeRun.id,
        operation,
        dedupeKey: secondaryEventId,
        targetIndexName: activeRun.targetIndexName,
      });
    }

    await transaction.organizationSearchOutbox.createMany({
      data: entries,
    });
  }
}
