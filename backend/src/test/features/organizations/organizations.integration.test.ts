import { buildApiPath } from "@/configuration/http/api-path";
import type { EmailJobPayload } from "@/features/email/email.model";
import { createFixtureId } from "@/seeds/types";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { peekRabbitMqMessages } from "../../support/live-rabbitmq";

const ORGANIZATION_ID = createFixtureId(1040, 1);
const EMAIL_QUEUE_NAME = "email.delivery.main";

async function readOrganizationInviteJob(
  persistenceApp: PersistenceTestApp,
  invitedEmail: string,
): Promise<Extract<EmailJobPayload, { kind: "organization_invite" }>> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5_000) {
    const messages = await peekRabbitMqMessages<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE_NAME,
      25,
    );
    const invite = messages
      .map((message) => message.payload)
      .find(
        (
          payload,
        ): payload is Extract<
          EmailJobPayload,
          { kind: "organization_invite" }
        > =>
          payload.kind === "organization_invite" &&
          payload.input.to === invitedEmail,
      );

    if (invite) {
      return invite;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Expected an organization invite email for ${invitedEmail}.`);
}

describe("Organizations persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("creates an organization and makes the creator its active primary manager", async () => {
    const founder = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/organizations")}`,
      {
        method: "POST",
        headers: founder.headers(),
        body: JSON.stringify({
          name: "Founders Guild",
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as {
      data: {
        organization: { id: string; name: string; role: string };
        membership: { role: string; isActive: boolean };
      };
    };
    const newOrganizationId = createBody.data.organization.id;
    expect(createBody.data.organization.name).toBe("Founders Guild");
    expect(createBody.data.organization.role).toBe("primary_manager");
    expect(createBody.data.membership.isActive).toBe(true);

    const membership =
      await persistenceApp.prisma.organizationMembership.findFirstOrThrow({
        where: {
          organizationId: newOrganizationId,
          user: {
            email: "viewer1@rentify.local",
          },
        },
      });
    expect(membership.role).toBe("primary_manager");

    const founderUser = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: {
        id: membership.userId,
      },
    });
    expect(founderUser.preferredOrganizationId).toBe(newOrganizationId);
  });

  it("persists invitation, acceptance, organization updates, role changes, and member removal", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const viewer = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });
    const memberToUpdate =
      await persistenceApp.prisma.organizationMembership.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          user: {
            email: "user2@rentify.local",
          },
        },
      });

    const updateOrganizationResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}`)}`,
      {
        method: "PATCH",
        headers: owner.headers(),
        body: JSON.stringify({
          name: "Northwind Studios",
        }),
      },
    );

    expect(updateOrganizationResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organization.findUniqueOrThrow({
        where: {
          id: ORGANIZATION_ID,
        },
      }),
    ).toMatchObject({
      name: "Northwind Studios",
    });

    const inviteViewerResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/invitations`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          email: "viewer1@rentify.local",
          role: "manager",
        }),
      },
    );

    expect(inviteViewerResponse.status).toBe(201);
    const viewerInvite = await readOrganizationInviteJob(
      persistenceApp,
      "viewer1@rentify.local",
    );
    expect(viewerInvite.input.token).toBeTruthy();

    const acceptResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/invitations/${viewerInvite.input.token}/accept`)}`,
      {
        method: "POST",
        headers: viewer.headers(),
      },
    );

    expect(acceptResponse.status).toBe(200);
    const acceptedMembership =
      await persistenceApp.prisma.organizationMembership.findFirst({
        where: {
          organizationId: ORGANIZATION_ID,
          userId: viewer.userId,
        },
      });
    expect(acceptedMembership).toMatchObject({
      organizationId: ORGANIZATION_ID,
      userId: viewer.userId,
      role: "manager",
    });

    const updateMemberRoleResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/members/${memberToUpdate.id}`)}`,
      {
        method: "PATCH",
        headers: owner.headers(),
        body: JSON.stringify({
          role: "manager",
        }),
      },
    );

    expect(updateMemberRoleResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationMembership.findUniqueOrThrow({
        where: {
          id: memberToUpdate.id,
        },
      }),
    ).toMatchObject({
      role: "manager",
    });

    const removeMemberResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/members/${memberToUpdate.id}`)}`,
      {
        method: "DELETE",
        headers: owner.headers(),
      },
    );

    expect(removeMemberResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationMembership.findUnique({
        where: {
          id: memberToUpdate.id,
        },
      }),
    ).toBeNull();

    const inviteExternalResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/invitations`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          email: "manager@example.com",
          role: "operator",
        }),
      },
    );

    expect(inviteExternalResponse.status).toBe(201);
    const externalInvite = await readOrganizationInviteJob(
      persistenceApp,
      "manager@example.com",
    );
    expect(externalInvite.input.role).toBe("operator");
    expect(externalInvite.input.organizationName).toBe("Northwind Studios");

    const externalInvitation =
      await persistenceApp.prisma.organizationInvitation.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          email: "manager@example.com",
          status: "pending",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    const revokeResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}/invitations/${externalInvitation.id}`)}`,
      {
        method: "DELETE",
        headers: owner.headers(),
      },
    );

    expect(revokeResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationInvitation.findUniqueOrThrow({
        where: {
          id: externalInvitation.id,
        },
      }),
    ).toMatchObject({
      status: "revoked",
    });
  });

  it("does not mutate the organization when a non-member tries to rename it", async () => {
    const viewer = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });

    const beforeOrganization =
      await persistenceApp.prisma.organization.findUniqueOrThrow({
        where: {
          id: ORGANIZATION_ID,
        },
      });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/${ORGANIZATION_ID}`)}`,
      {
        method: "PATCH",
        headers: viewer.headers(),
        body: JSON.stringify({
          name: "Unauthorized Rename",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(
      await persistenceApp.prisma.organization.findUniqueOrThrow({
        where: {
          id: ORGANIZATION_ID,
        },
      }),
    ).toMatchObject({
      name: beforeOrganization.name,
    });
  });
});
