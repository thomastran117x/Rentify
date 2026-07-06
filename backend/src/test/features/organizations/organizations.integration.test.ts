import { buildApiPath } from "@/configuration/http/api-path";
import { createFixtureId } from "@/seeds/types";
import { createAuthenticatedRequestContext, createPersistenceTestApp, resetPersistenceState, teardownPersistenceTestApp, type PersistenceTestApp } from "../../support/persistence-test-app";

const ORGANIZATION_ID = createFixtureId(1040, 1);

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

  it("persists invitation, acceptance, organization updates, role changes, and member removal", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const viewer = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });
    const memberToUpdate = await persistenceApp.prisma.organizationMembership.findFirstOrThrow({
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
    const invitePayload = persistenceApp.stubs.emailQueueService.enqueueEmailJob.mock.calls.at(-1)?.[1] as {
      token: string;
    };
    expect(invitePayload?.token).toBeTruthy();

    const acceptResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/organizations/invitations/${invitePayload.token}/accept`)}`,
      {
        method: "POST",
        headers: viewer.headers(),
      },
    );

    expect(acceptResponse.status).toBe(200);
    const acceptedMembership = await persistenceApp.prisma.organizationMembership.findFirst({
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
    const externalInvitation = await persistenceApp.prisma.organizationInvitation.findFirstOrThrow({
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

    const beforeOrganization = await persistenceApp.prisma.organization.findUniqueOrThrow({
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

