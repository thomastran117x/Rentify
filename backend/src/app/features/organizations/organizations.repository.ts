import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  maskEmailAddress,
  type OrganizationDetailResult,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationMembershipSummary,
  type OrganizationProfileFields,
  type OrganizationProfileInput,
  type OrganizationRole,
  type OrganizationSummary,
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
        input.customFields === null || Object.keys(input.customFields).length === 0
          ? Prisma.DbNull
          : (input.customFields as Prisma.InputJsonValue);
    }
    return data;
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
  ): Promise<OrganizationDetailResult | null> {
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
