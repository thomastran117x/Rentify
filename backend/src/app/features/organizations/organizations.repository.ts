import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  maskEmailAddress,
  type ListPublicOrganizationsInput,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationMembershipSummary,
  type OrganizationProfileFields,
  type OrganizationProfileInput,
  type OrganizationRole,
  type OrganizationSearchDocument,
  type OrganizationSearchOutboxRecord,
  type OrganizationSummary,
  type OrganizationWorkspaceDetailResult,
  type PublicOrganizationDetailResult,
  type PublicOrganizationListResult,
  type PublicOrganizationProfileFields,
  type PublicOrganizationSummary,
} from "@/features/organizations/organizations.model";
import type {
  SearchOutboxLagMetrics,
  SearchReindexRunRecord,
  SearchReindexStatus,
} from "@/features/search/search.model";

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

type OrganizationDetailPersistence = Prisma.OrganizationGetPayload<{
  include: {
    memberships: {
      include: {
        user: {
          include: {
            profile: true;
          };
        };
      };
      orderBy: {
        createdAt: "asc";
      };
    };
    invitations: {
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
      orderBy: {
        createdAt: "desc";
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

type InvitationWithOrganizationPersistence =
  Prisma.OrganizationInvitationGetPayload<{
    include: {
      organization: true;
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

export interface OrganizationMembershipAccessRecord {
  membershipId: string;
  organization: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  } & OrganizationProfileFields;
  role: OrganizationRole;
}

export interface OrganizationInviteAccessRecord
  extends OrganizationInvitationRecord {
  organization: {
    id: string;
    name: string;
  };
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

type SearchReindexCatchUpState =
  | {
      state: "waiting";
    }
  | {
      state: "caught_up";
    }
  | {
      state: "failed";
      errorMessage: string;
    };

interface SearchOutboxIdRow {
  id: string;
}

interface SearchIdRow {
  id: string;
}

interface SearchOutboxLagRow {
  unpublishedCount?: bigint | number | null;
  unpublishedOldestCreatedAt?: Date | null;
  publishedNotIndexedCount?: bigint | number | null;
  publishedNotIndexedOldestProcessedAt?: Date | null;
  upsertDeadLetteredCount?: bigint | number | null;
  deleteDeadLetteredCount?: bigint | number | null;
  barrierDeadLetteredCount?: bigint | number | null;
}

interface LockRow {
  acquired?: bigint | number | boolean | null;
  released?: bigint | number | boolean | null;
}

type OrganizationSearchDocumentRow = {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const ORGANIZATION_SEARCH_REINDEX_START_LOCK_NAME =
  "rentify:organization-search-reindex:start";

export class OrganizationsRepository extends BaseRepository {
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
      id: organization.id,
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
    organizationId: string,
  ): Promise<PublicOrganizationDetailResult | null> {
    const rows = await this.executeAsync(() =>
      this.prisma.$queryRaw<PublicOrganizationRow[]>(Prisma.sql`
        SELECT
          o.id AS id,
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
  async listMembershipsByUserId(
    userId: string,
    preferredOrganizationId?: string | null,
  ): Promise<OrganizationMembershipSummary[]> {
    const memberships = await this.executeAsync(() =>
      this.prisma.organizationMembership.findMany({
        where: {
          userId,
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
        orderBy: [
          {
            organization: {
              name: "asc",
            },
          },
          {
            createdAt: "asc",
          },
        ],
      }),
    );

    const resolvedActiveOrganizationId =
      preferredOrganizationId ?? memberships[0]?.organizationId;

    return memberships.map((membership) =>
      this.mapMembershipSummary(membership, resolvedActiveOrganizationId),
    );
  }

  async findMembershipAccess(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembershipAccessRecord | null> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    if (!membership) {
      return null;
    }

    return {
      membershipId: membership.id,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        createdAt: membership.organization.createdAt.toISOString(),
        updatedAt: membership.organization.updatedAt.toISOString(),
        ...this.mapOrganizationProfileFields(membership.organization),
      },
      role: membership.role,
    };
  }

  async findPrimaryManagerUserId(
    organizationId: string,
  ): Promise<string | null> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.findFirst({
        where: {
          organizationId,
          role: "primary_manager",
        },
        select: {
          userId: true,
        },
      }),
    );

    return membership?.userId ?? null;
  }

  async findOrganizationDetail(
    organizationId: string,
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
        id: organization.id,
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

  async setPreferredOrganization(
    userId: string,
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
    organizationId: string,
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
      id: organization.id,
      name: organization.name,
      role: "operator",
      ...this.mapOrganizationProfileFields(organization),
    };
  }

  async updateOrganizationName(
    organizationId: string,
    name: string,
  ): Promise<OrganizationSummary & OrganizationProfileFields> {
    return this.updateOrganization(organizationId, { name });
  }

  async findMemberById(
    organizationId: string,
    membershipId: string,
  ): Promise<OrganizationMemberRecord | null> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.findFirst({
        where: {
          id: membershipId,
          organizationId,
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return membership ? this.mapMemberRecord(membership) : null;
  }

  async findMemberByUserId(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMemberRecord | null> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return membership ? this.mapMemberRecord(membership) : null;
  }

  async findMemberByEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationMemberRecord | null> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.findFirst({
        where: {
          organizationId,
          user: {
            email,
          },
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return membership ? this.mapMemberRecord(membership) : null;
  }

  async updateMembershipRole(
    membershipId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMemberRecord> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.update({
        where: {
          id: membershipId,
        },
        data: {
          role,
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return this.mapMemberRecord(membership);
  }

  async restoreMembership(input: {
    membershipId: string;
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<OrganizationMemberRecord> {
    const membership = await this.executeAsync(() =>
      this.prisma.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
        update: {
          role: input.role,
        },
        create: {
          id: input.membershipId,
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
        },
        include: {
          organization: true,
          user: {
            include: {
              profile: true,
            },
          },
        },
      }),
    );

    return this.mapMemberRecord(membership);
  }
  async removeMembership(membershipId: string): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.organizationMembership.deleteMany({
        where: {
          id: membershipId,
        },
      }),
    );

    return result.count > 0;
  }

  async reissueInvitation(input: {
    organizationId: string;
    invitedByUserId: string;
    email: string;
    role: OrganizationRole;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<OrganizationInvitationRecord> {
    return this.executeTransaction(async (transaction) => {
      await transaction.organizationInvitation.updateMany({
        where: {
          organizationId: input.organizationId,
          email: input.email,
          status: "pending",
        },
        data: {
          status: "revoked",
          revokedAt: input.now,
        },
      });

      const invitation = await transaction.organizationInvitation.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          invitedByUserId: input.invitedByUserId,
          email: input.email,
          role: input.role,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
        include: {
          organization: true,
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
      });

      return this.mapInvitationRecord(invitation);
    });
  }

  async findInvitationById(
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInviteAccessRecord | null> {
    const invitation = await this.executeAsync(() =>
      this.prisma.organizationInvitation.findFirst({
        where: {
          id: invitationId,
          organizationId,
        },
        include: {
          organization: true,
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
      }),
    );

    if (!invitation) {
      return null;
    }

    return {
      ...this.mapInvitationRecord(invitation),
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
      },
    };
  }

  async findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<OrganizationInviteAccessRecord | null> {
    const invitation = await this.executeAsync(() =>
      this.prisma.organizationInvitation.findUnique({
        where: {
          tokenHash,
        },
        include: {
          organization: true,
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
      }),
    );

    if (!invitation) {
      return null;
    }

    return {
      ...this.mapInvitationRecord(invitation),
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
      },
    };
  }

  async revokeInvitation(
    invitationId: string,
    now: Date,
  ): Promise<OrganizationInvitationRecord | null> {
    return this.executeTransaction(async (transaction) => {
      const invitation = await transaction.organizationInvitation.findUnique({
        where: {
          id: invitationId,
        },
        include: {
          organization: true,
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
      });

      if (!invitation || invitation.status !== "pending") {
        return null;
      }

      const updated = await transaction.organizationInvitation.update({
        where: {
          id: invitationId,
        },
        data: {
          status: "revoked",
          revokedAt: now,
        },
        include: {
          organization: true,
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
      });

      return this.mapInvitationRecord(updated);
    });
  }

  async expireInvitation(
    invitationId: string,
    now: Date,
  ): Promise<OrganizationInvitationRecord | null> {
    return this.executeTransaction(async (transaction) => {
      const invitation = await transaction.organizationInvitation.findUnique({
        where: {
          id: invitationId,
        },
        include: {
          organization: true,
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
      });

      if (!invitation || invitation.status !== "pending") {
        return null;
      }

      const updated = await transaction.organizationInvitation.update({
        where: {
          id: invitationId,
        },
        data: {
          status: "expired",
          updatedAt: now,
        },
        include: {
          organization: true,
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
      });

      return this.mapInvitationRecord(updated);
    });
  }

  async acceptInvitation(input: {
    invitationId: string;
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    now: Date;
  }): Promise<{
    invitation: OrganizationInvitationRecord;
    membership: OrganizationMemberRecord;
  }> {
    return this.executeTransaction(async (transaction) => {
      const membership = await transaction.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
        update: {},
        create: {
          id: randomUUID(),
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
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

      const invitation = await transaction.organizationInvitation.update({
        where: {
          id: input.invitationId,
        },
        data: {
          status: "accepted",
          acceptedByUserId: input.userId,
          acceptedAt: input.now,
          revokedAt: null,
        },
        include: {
          organization: true,
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
      });

      return {
        invitation: this.mapInvitationRecord(invitation),
        membership: this.mapMemberRecord(membership),
      };
    });
  }

  async createOrganizationWithOwner(
    input: {
      name: string;
      ownerUserId: string;
    } & OrganizationProfileInput,
  ): Promise<OrganizationMembershipSummary> {
    const { name, ownerUserId, ...profile } = input;
    return this.executeTransaction(async (transaction) => {
      const organizationData: Prisma.OrganizationUncheckedCreateInput = {
        id: randomUUID(),
        name,
      };
      Object.assign(organizationData, this.buildOrganizationWriteData(profile));

      const organization = await transaction.organization.create({
        data: organizationData,
      });

      await this.enqueueSearchOutbox(transaction, organization.id, "upsert");

      const membership = await transaction.organizationMembership.create({
        data: {
          id: randomUUID(),
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
      membershipId: membership.id,
      id: membership.organization.id,
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
      membershipId: membership.id,
      userId: membership.user.id,
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
      id: invitation.id,
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
        id: invitation.invitedByUser.id,
        email: invitation.invitedByUser.email,
        username:
          invitation.invitedByUser.profile?.username ??
          invitation.invitedByUser.email,
      },
      acceptedBy: invitation.acceptedByUser
        ? {
            id: invitation.acceptedByUser.id,
            email: invitation.acceptedByUser.email,
            username:
              invitation.acceptedByUser.profile?.username ??
              invitation.acceptedByUser.email,
          }
        : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Elasticsearch-backed public directory search
  // ---------------------------------------------------------------------------

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

  async findByIdsForIndexing(
    ids: string[],
  ): Promise<OrganizationSearchDocument[]> {
    if (ids.length === 0) {
      return [];
    }

    const organizations = await this.executeAsync(() =>
      this.prisma.organization.findMany({
        where: {
          id: {
            in: ids,
          },
        },
      }),
    );

    return organizations.map((organization) =>
      this.mapSearchDocument(organization),
    );
  }

  async listRecentForIndexReconciliation(
    limit: number,
  ): Promise<OrganizationSearchDocument[]> {
    const organizations = await this.executeAsync(() =>
      this.prisma.organization.findMany({
        orderBy: [
          {
            updatedAt: "desc",
          },
          {
            id: "asc",
          },
        ],
        take: limit,
      }),
    );

    return organizations.map((organization) =>
      this.mapSearchDocument(organization),
    );
  }

  async countOrganizationsForIndexing(
    sourceSnapshotAt?: string,
  ): Promise<number> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    return this.executeAsync(() =>
      this.prisma.organization.count({
        where: snapshotAt
          ? {
              updatedAt: {
                lte: snapshotAt,
              },
            }
          : {},
      }),
    );
  }

  async listForIndexingBatch(
    limit: number,
    cursorId?: string,
    sourceSnapshotAt?: string,
  ): Promise<OrganizationSearchDocument[]> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    const organizations = await this.executeAsync(() =>
      this.prisma.organization.findMany({
        where: snapshotAt
          ? {
              updatedAt: {
                lte: snapshotAt,
              },
            }
          : {},
        orderBy: {
          id: "asc",
        },
        take: limit,
        ...(cursorId
          ? {
              cursor: {
                id: cursorId,
              },
              skip: 1,
            }
          : {}),
      }),
    );

    return organizations.map((organization) =>
      this.mapSearchDocument(organization),
    );
  }

  async claimSearchOutboxBatch(
    limit: number,
  ): Promise<OrganizationSearchOutboxRecord[]> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const claimedRows = await this.prisma.$transaction(
        async (transaction) => {
          const idRows = await transaction.$queryRaw<SearchOutboxIdRow[]>(
            Prisma.sql`
            SELECT id
            FROM organization_search_outbox
            WHERE processed_at IS NULL
              AND dead_lettered_at IS NULL
              AND available_at <= ${now}
              AND (processing_at IS NULL OR processing_at < ${staleProcessingThreshold})
            ORDER BY available_at ASC, created_at ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          `,
          );
          const ids = idRows.map((row) => row.id);

          if (ids.length === 0) {
            return [];
          }

          await transaction.organizationSearchOutbox.updateMany({
            where: {
              id: {
                in: ids,
              },
            },
            data: {
              processingAt: now,
            },
          });

          const rows = await transaction.organizationSearchOutbox.findMany({
            where: {
              id: {
                in: ids,
              },
            },
          });
          const byId = new Map(rows.map((row) => [row.id, row]));

          return ids
            .map((id) => byId.get(id))
            .filter((row): row is NonNullable<typeof row> => Boolean(row));
        },
      );

      return claimedRows.map((row) => this.mapSearchOutbox(row, now));
    });
  }

  async markSearchOutboxIndexed(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
        where: {
          id,
        },
        data: {
          indexedAt: new Date(),
          lastError: null,
        },
      }),
    );
  }

  async markSearchOutboxesIndexed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.updateMany({
        where: {
          id: {
            in: ids,
          },
        },
        data: {
          indexedAt: new Date(),
          lastError: null,
        },
      }),
    );
  }

  async incrementSearchOutboxAttempt(
    id: string,
    errorMessage: string,
  ): Promise<number> {
    const updated = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
        where: {
          id,
        },
        data: {
          attempts: {
            increment: 1,
          },
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );

    return updated.attempts;
  }

  async markSearchOutboxDeadLettered(
    id: string,
    errorMessage: string,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
        where: {
          id,
        },
        data: {
          deadLetteredAt: new Date(),
          processingAt: null,
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async markSearchOutboxPublishRetry(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    const backoffSeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
        where: {
          id,
        },
        data: {
          publishAttempts: {
            increment: 1,
          },
          processingAt: null,
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async getSearchOutboxById(
    id: string,
  ): Promise<OrganizationSearchOutboxRecord | null> {
    const outbox = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.findUnique({
        where: {
          id,
        },
      }),
    );

    return outbox ? this.mapSearchOutbox(outbox) : null;
  }

  async getSearchOutboxesByIds(
    ids: string[],
  ): Promise<OrganizationSearchOutboxRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.findMany({
        where: {
          id: {
            in: ids,
          },
        },
      }),
    );
    const byId = new Map(
      rows.map((row) => [row.id, this.mapSearchOutbox(row)]),
    );

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async hasNewerSearchOutboxJob(
    job: Pick<
      OrganizationSearchOutboxRecord,
      "id" | "organizationId" | "reindexRunId" | "targetIndexName" | "createdAt"
    >,
  ): Promise<boolean> {
    if (!job.organizationId) {
      return false;
    }

    const count = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.count({
        where: {
          organizationId: job.organizationId,
          reindexRunId: job.reindexRunId ?? null,
          targetIndexName: job.targetIndexName ?? null,
          deadLetteredAt: null,
          id: {
            not: job.id,
          },
          createdAt: {
            gt: new Date(job.createdAt),
          },
        },
      }),
    );

    return count > 0;
  }

  async markSearchOutboxRelayed(
    id: string,
    supersededIds: string[],
    brokerMessageId?: string,
  ): Promise<void> {
    const now = new Date();

    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        await transaction.organizationSearchOutbox.update({
          where: {
            id,
          },
          data: {
            processedAt: now,
            processingAt: null,
            brokerMessageId: brokerMessageId ?? null,
            lastError: null,
          },
        });

        if (supersededIds.length > 0) {
          await transaction.organizationSearchOutbox.updateMany({
            where: {
              id: {
                in: supersededIds,
              },
            },
            data: {
              processedAt: now,
              indexedAt: now,
              processingAt: null,
              brokerMessageId: brokerMessageId ?? null,
              lastError: null,
            },
          });
        }
      }),
    );
  }

  async releaseSearchOutboxClaims(
    ids: string[],
    errorMessage?: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.updateMany({
        where: {
          id: {
            in: ids,
          },
          indexedAt: null,
          deadLetteredAt: null,
        },
        data: {
          processingAt: null,
          ...(errorMessage !== undefined
            ? {
                lastError: errorMessage.slice(0, 2048),
              }
            : {}),
        },
      }),
    );
  }

  async reviveDeadLetteredSearchOutbox(limit: number): Promise<number> {
    if (limit <= 0) {
      return 0;
    }

    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.organizationSearchOutbox.findMany({
          where: {
            deadLetteredAt: {
              not: null,
            },
            operation: {
              in: ["upsert", "delete"],
            },
          },
          orderBy: [
            {
              deadLetteredAt: "asc",
            },
            {
              createdAt: "asc",
            },
          ],
          take: limit,
          select: {
            id: true,
          },
        });
        const ids = rows.map((row) => row.id);

        if (ids.length === 0) {
          return 0;
        }

        await transaction.organizationSearchOutbox.updateMany({
          where: {
            id: {
              in: ids,
            },
          },
          data: {
            deadLetteredAt: null,
            processedAt: null,
            indexedAt: null,
            processingAt: null,
            brokerMessageId: null,
            lastError: null,
            attempts: 0,
            publishAttempts: 0,
            availableAt: new Date(),
          },
        });

        return ids.length;
      }),
    );
  }

  async getSearchOutboxLagMetrics(): Promise<SearchOutboxLagMetrics> {
    return this.executeAsync(async () => {
      const [row] = await this.prisma.$queryRaw<
        SearchOutboxLagRow[]
      >(Prisma.sql`
        SELECT
          SUM(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS unpublishedCount,
          MIN(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN created_at ELSE NULL END) AS unpublishedOldestCreatedAt,
          SUM(CASE WHEN processed_at IS NOT NULL AND indexed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS publishedNotIndexedCount,
          MIN(CASE WHEN processed_at IS NOT NULL AND indexed_at IS NULL AND dead_lettered_at IS NULL THEN processed_at ELSE NULL END) AS publishedNotIndexedOldestProcessedAt,
          SUM(CASE WHEN dead_lettered_at IS NOT NULL AND operation = 'upsert' THEN 1 ELSE 0 END) AS upsertDeadLetteredCount,
          SUM(CASE WHEN dead_lettered_at IS NOT NULL AND operation = 'delete' THEN 1 ELSE 0 END) AS deleteDeadLetteredCount,
          SUM(CASE WHEN dead_lettered_at IS NOT NULL AND operation = 'barrier' THEN 1 ELSE 0 END) AS barrierDeadLetteredCount
        FROM organization_search_outbox
      `);

      return {
        unpublishedCount: this.readNumberLike(row?.unpublishedCount),
        ...(row?.unpublishedOldestCreatedAt
          ? {
              unpublishedOldestAgeMs: Math.max(
                0,
                Date.now() - row.unpublishedOldestCreatedAt.getTime(),
              ),
            }
          : {}),
        publishedNotIndexedCount: this.readNumberLike(
          row?.publishedNotIndexedCount,
        ),
        ...(row?.publishedNotIndexedOldestProcessedAt
          ? {
              publishedNotIndexedOldestAgeMs: Math.max(
                0,
                Date.now() - row.publishedNotIndexedOldestProcessedAt.getTime(),
              ),
            }
          : {}),
        deadLetteredByOperation: {
          upsert: this.readNumberLike(row?.upsertDeadLetteredCount),
          delete: this.readNumberLike(row?.deleteDeadLetteredCount),
          barrier: this.readNumberLike(row?.barrierDeadLetteredCount),
        },
      };
    });
  }

  async createSearchReindexRun(
    targetIndexName: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.create({
        data: {
          id: randomUUID(),
          status: "pending",
          targetIndexName,
          sourceSnapshotAt: new Date(),
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async findSearchReindexRunById(
    id: string,
  ): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.findUnique({
        where: {
          id,
        },
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findActiveSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.findFirst({
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
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findLatestSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.findFirst({
        orderBy: [
          {
            createdAt: "desc",
          },
        ],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findLatestCompletedSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.findFirst({
        where: {
          status: "completed",
        },
        orderBy: [
          {
            completedAt: "desc",
          },
          {
            createdAt: "desc",
          },
        ],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async listCompletedSearchReindexRunsWithRetainedIndices(): Promise<
    SearchReindexRunRecord[]
  > {
    const runs = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.findMany({
        where: {
          status: "completed",
          retainedIndexName: {
            not: null,
          },
        },
        orderBy: [
          {
            completedAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      }),
    );

    return runs.map((run) => this.mapSearchReindexRun(run));
  }

  async claimNextSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const candidate = await this.prisma.organizationSearchReindexRun.findFirst(
        {
          where: {
            status: {
              in: ["pending", "running", "waiting_for_catchup"],
            },
            OR: [
              {
                processingAt: null,
              },
              {
                processingAt: {
                  lt: staleProcessingThreshold,
                },
              },
            ],
          },
          orderBy: [
            {
              createdAt: "asc",
            },
          ],
        },
      );

      if (!candidate) {
        return null;
      }

      const result = await this.prisma.organizationSearchReindexRun.updateMany({
        where: {
          id: candidate.id,
          OR: [
            {
              processingAt: null,
            },
            {
              processingAt: {
                lt: staleProcessingThreshold,
              },
            },
          ],
        },
        data: {
          processingAt: now,
        },
      });

      if (result.count !== 1) {
        return null;
      }

      return this.mapSearchReindexRun({
        ...candidate,
        processingAt: now,
      });
    });
  }

  async markSearchReindexRunRunning(
    id: string,
    totalDocuments: number,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "running",
          totalDocuments,
          startedAt: new Date(),
          processingAt: new Date(),
          lastError: null,
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async updateSearchReindexRunProgress(
    id: string,
    input: {
      indexedDocuments: number;
      failedDocuments?: number;
    },
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          indexedDocuments: input.indexedDocuments,
          ...(input.failedDocuments !== undefined
            ? {
                failedDocuments: input.failedDocuments,
              }
            : {}),
        },
      }),
    );
  }

  async enqueueSearchReindexBarrier(
    reindexRunId: string,
    targetIndexName: string,
  ): Promise<OrganizationSearchOutboxRecord> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const barrierId = randomUUID();

        const created = await transaction.organizationSearchOutbox.create({
          data: {
            id: barrierId,
            reindexRunId,
            operation: "barrier",
            dedupeKey: barrierId,
            targetIndexName,
          },
        });

        await transaction.organizationSearchReindexRun.update({
          where: {
            id: reindexRunId,
          },
          data: {
            status: "waiting_for_catchup",
            barrierOutboxId: barrierId,
            processingAt: null,
          },
        });

        return this.mapSearchOutbox(created);
      }),
    );
  }

  async getSearchReindexCatchUpState(
    id: string,
  ): Promise<SearchReindexCatchUpState> {
    return this.executeAsync(async () => {
      const run = await this.prisma.organizationSearchReindexRun.findUnique({
        where: {
          id,
        },
        select: {
          barrierOutboxId: true,
        },
      });

      if (!run?.barrierOutboxId) {
        return {
          state: "failed",
          errorMessage:
            "Search reindex run is missing its barrier outbox reference.",
        };
      }

      const barrier = await this.prisma.organizationSearchOutbox.findUnique({
        where: {
          id: run.barrierOutboxId,
        },
        select: {
          createdAt: true,
          indexedAt: true,
          deadLetteredAt: true,
          lastError: true,
        },
      });

      if (!barrier) {
        return {
          state: "failed",
          errorMessage:
            "Search reindex barrier outbox entry could not be found.",
        };
      }

      if (barrier.deadLetteredAt) {
        return {
          state: "failed",
          errorMessage: barrier.lastError
            ? `Search reindex barrier could not complete: ${barrier.lastError}`
            : "Search reindex barrier could not complete because the barrier outbox entry was dead-lettered.",
        };
      }

      if (!barrier.indexedAt) {
        return {
          state: "waiting",
        };
      }

      const remaining = await this.prisma.organizationSearchOutbox.count({
        where: {
          reindexRunId: id,
          deadLetteredAt: null,
          indexedAt: null,
          createdAt: {
            lte: barrier.createdAt,
          },
        },
      });

      return remaining === 0
        ? {
            state: "caught_up",
          }
        : {
            state: "waiting",
          };
    });
  }

  async markSearchReindexRunCompleted(
    id: string,
    retainedIndexName?: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "completed",
          retainedIndexName: retainedIndexName ?? null,
          completedAt: new Date(),
          processingAt: null,
          lastError: null,
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async markSearchReindexRunFailed(
    id: string,
    errorMessage: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "failed",
          failedAt: new Date(),
          processingAt: null,
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async touchSearchReindexRunProcessing(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          processingAt: new Date(),
        },
      }),
    );
  }

  async clearSearchReindexRunProcessing(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          processingAt: null,
        },
      }),
    );
  }

  async clearSearchReindexRunRetainedIndexName(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          retainedIndexName: null,
        },
      }),
    );
  }

  async withSearchReindexStartLock<T>(
    operation: (helpers: {
      findActiveSearchReindexRun: () => Promise<SearchReindexRunRecord | null>;
      createSearchReindexRun: (
        targetIndexName: string,
      ) => Promise<SearchReindexRunRecord>;
    }) => Promise<T>,
  ): Promise<T | null> {
    return this.executeAsync(
      () =>
        this.prisma.$transaction(async (transaction) => {
          const lockRows = await transaction.$queryRaw<LockRow[]>(
            Prisma.sql`SELECT GET_LOCK(${ORGANIZATION_SEARCH_REINDEX_START_LOCK_NAME}, 0) AS acquired`,
          );
          const acquired = this.readMysqlLockResult(lockRows[0]?.acquired);

          if (!acquired) {
            return null;
          }

          try {
            return await operation({
              findActiveSearchReindexRun: async () => {
                const run =
                  await transaction.organizationSearchReindexRun.findFirst({
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
                  });

                return run ? this.mapSearchReindexRun(run) : null;
              },
              createSearchReindexRun: async (targetIndexName: string) => {
                const run =
                  await transaction.organizationSearchReindexRun.create({
                    data: {
                      id: randomUUID(),
                      status: "pending",
                      targetIndexName,
                      sourceSnapshotAt: new Date(),
                    },
                  });

                return this.mapSearchReindexRun(run);
              },
            });
          } finally {
            await transaction.$queryRaw<LockRow[]>(
              Prisma.sql`SELECT RELEASE_LOCK(${ORGANIZATION_SEARCH_REINDEX_START_LOCK_NAME}) AS released`,
            );
          }
        }),
      {
        operationName: "withOrganizationSearchReindexStartLock",
      },
    );
  }

  private async enqueueSearchOutbox(
    transaction: Prisma.TransactionClient,
    organizationId: string,
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
    const primaryEventId = randomUUID();
    const entries: Prisma.OrganizationSearchOutboxCreateManyInput[] = [
      {
        id: primaryEventId,
        organizationId,
        operation,
        dedupeKey: primaryEventId,
      },
    ];

    if (activeRun) {
      const secondaryEventId = randomUUID();
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

  private mapSearchDocument(
    organization: OrganizationSearchDocumentRow,
  ): OrganizationSearchDocument {
    return {
      id: organization.id,
      name: organization.name,
      description: organization.description,
      city: organization.city,
      region: organization.region,
      country: organization.country,
      postalCode: organization.postalCode ?? null,
      createdAt: new Date(organization.createdAt).toISOString(),
      updatedAt: new Date(organization.updatedAt).toISOString(),
    };
  }

  private mapSearchOutbox(
    outbox: Prisma.OrganizationSearchOutboxGetPayload<object>,
    processingAt?: Date,
  ): OrganizationSearchOutboxRecord {
    return {
      id: outbox.id,
      organizationId: outbox.organizationId ?? undefined,
      reindexRunId: outbox.reindexRunId ?? undefined,
      operation: outbox.operation,
      dedupeKey: outbox.dedupeKey,
      targetIndexName: outbox.targetIndexName ?? undefined,
      attempts: outbox.attempts,
      publishAttempts: outbox.publishAttempts,
      availableAt: outbox.availableAt.toISOString(),
      processingAt: (
        processingAt ??
        outbox.processingAt ??
        undefined
      )?.toISOString(),
      publishedAt: outbox.processedAt?.toISOString(),
      indexedAt: outbox.indexedAt?.toISOString(),
      deadLetteredAt: outbox.deadLetteredAt?.toISOString(),
      brokerMessageId: outbox.brokerMessageId ?? undefined,
      lastError: outbox.lastError ?? undefined,
      createdAt: outbox.createdAt.toISOString(),
      updatedAt: outbox.updatedAt.toISOString(),
    };
  }

  private mapSearchReindexRun(
    run: Prisma.OrganizationSearchReindexRunGetPayload<object>,
  ): SearchReindexRunRecord {
    return {
      id: run.id,
      status: run.status as SearchReindexStatus,
      targetIndexName: run.targetIndexName,
      retainedIndexName: run.retainedIndexName ?? undefined,
      sourceSnapshotAt: run.sourceSnapshotAt.toISOString(),
      barrierOutboxId: run.barrierOutboxId ?? undefined,
      totalPostings: run.totalDocuments,
      indexedPostings: run.indexedDocuments,
      failedPostings: run.failedDocuments,
      startedAt: run.startedAt?.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      failedAt: run.failedAt?.toISOString(),
      processingAt: run.processingAt?.toISOString(),
      lastError: run.lastError ?? undefined,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private readMysqlLockResult(
    value: bigint | number | boolean | null | undefined,
  ): boolean {
    if (typeof value === "bigint") {
      return value === 1n;
    }

    if (typeof value === "number") {
      return value === 1;
    }

    return value === true;
  }
}
