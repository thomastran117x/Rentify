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
  type OrganizationSummary,
  type OrganizationWorkspaceDetailResult,
  type PublicOrganizationDetailResult,
  type PublicOrganizationListResult,
  type PublicOrganizationProfileFields,
} from "@/features/organizations/organizations.model";

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
    return `%${query.trim().toLowerCase()}%`;
  }

  async listPublicOrganizations(
    input: ListPublicOrganizationsInput,
  ): Promise<PublicOrganizationListResult> {
    const whereSql = input.query
      ? Prisma.sql`WHERE LOWER(o.name) LIKE ${this.createLikePattern(input.query)}`
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
          INNER JOIN postings p
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
            INNER JOIN postings p
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
        INNER JOIN postings p
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

    const organization = await this.executeAsync(() =>
      this.prisma.organization.update({
        where: {
          id: organizationId,
        },
        data,
      }),
    );

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
}

