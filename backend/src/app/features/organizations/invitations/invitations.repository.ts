import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  maskEmailAddress,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
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

export interface OrganizationInviteAccessRecord
  extends OrganizationInvitationRecord {
  organization: {
    id: string;
    slug: string;
    name: string;
  };
}

export class OrganizationsInvitationsRepository extends BaseRepository {
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
        slug: invitation.organization.slug,
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
        slug: invitation.organization.slug,
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
