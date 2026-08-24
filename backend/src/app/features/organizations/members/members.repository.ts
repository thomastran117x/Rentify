import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  OrganizationMemberRecord,
  OrganizationMembershipSummary,
  OrganizationProfileFields,
  OrganizationRole,
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

export interface OrganizationMembershipAccessRecord {
  membershipId: string;
  organization: {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  } & OrganizationProfileFields;
  role: OrganizationRole;
}

export class OrganizationsMembersRepository extends BaseRepository {
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
        slug: membership.organization.slug,
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

  private mapMembershipSummary(
    membership: MembershipWithOrganizationPersistence,
    activeOrganizationId?: string | null,
  ): OrganizationMembershipSummary {
    return {
      membershipId: membership.id,
      id: membership.organization.id,
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
}
