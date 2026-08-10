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

  async function request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function readData<TData>(response: Response): Promise<TData> {
    const body = (await response.json()) as { data: TData };
    return body.data;
  }

  async function readOrganization() {
    return persistenceApp.prisma.organization.findUniqueOrThrow({
      where: { id: ORGANIZATION_ID },
    });
  }

  /**
   * Organization reviews require a reviewer who is not a member and who has a
   * completed, undisputed rental with the organization. The seeded rentings are
   * future dated, so an existing one is retargeted at the reviewer instead of
   * building a renting graph by hand.
   *
   * Any seeded review by this reviewer is cleared too: one review per reviewer
   * per organization is allowed, so a leftover fixture would make a create
   * return 409 rather than exercising the lifecycle.
   */
  async function makeReviewerEligible(reviewerId: string): Promise<void> {
    await persistenceApp.prisma.organizationReview.deleteMany({
      where: { organizationId: ORGANIZATION_ID, reviewerId },
    });

    const renting = await persistenceApp.prisma.renting.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID },
    });

    await persistenceApp.prisma.rentingDispute.deleteMany({
      where: { rentingId: renting.id },
    });

    await persistenceApp.prisma.renting.update({
      where: { id: renting.id },
      data: {
        renterId: reviewerId,
        status: "completed",
        completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
  }

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

  it("exposes an organization through public discovery and member workspace reads", async () => {
    const organization = await readOrganization();
    const manager = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const nonMember = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });

    const publicListResponse = await request("/organizations");
    expect(publicListResponse.status).toBe(200);
    const publicList = await readData<{
      organizations: Array<{ id: string }>;
    }>(publicListResponse);
    expect(publicList.organizations.map((entry) => entry.id)).toContain(
      ORGANIZATION_ID,
    );

    const publicDetailResponse = await request(
      `/organizations/${ORGANIZATION_ID}`,
    );
    expect(publicDetailResponse.status).toBe(200);
    await expect(publicDetailResponse.json()).resolves.toMatchObject({
      data: {
        organization: { id: ORGANIZATION_ID, name: organization.name },
      },
    });

    const bySlugResponse = await request(
      `/organizations/by-slug/${organization.slug}`,
    );
    expect(bySlugResponse.status).toBe(200);
    await expect(bySlugResponse.json()).resolves.toMatchObject({
      data: {
        organizationId: ORGANIZATION_ID,
        canonicalSlug: organization.slug,
      },
    });

    const myOrganizationsResponse = await request("/organizations/me", {
      headers: manager.headers(),
    });
    expect(myOrganizationsResponse.status).toBe(200);
    const myOrganizations = await readData<{
      memberships: Array<{ id: string; role: string }>;
    }>(myOrganizationsResponse);
    expect(myOrganizations.memberships).toContainEqual(
      expect.objectContaining({ id: ORGANIZATION_ID, role: "manager" }),
    );

    const setActiveResponse = await request("/organizations/me/active", {
      method: "POST",
      headers: manager.headers(),
      body: JSON.stringify({ organizationId: ORGANIZATION_ID }),
    });
    expect(setActiveResponse.status).toBe(200);
    expect(
      (
        await persistenceApp.prisma.user.findUniqueOrThrow({
          where: { id: manager.userId },
        })
      ).preferredOrganizationId,
    ).toBe(ORGANIZATION_ID);

    const workspaceResponse = await request(
      `/organizations/${ORGANIZATION_ID}/workspace`,
      { headers: manager.headers() },
    );
    expect(workspaceResponse.status).toBe(200);
    await expect(workspaceResponse.json()).resolves.toMatchObject({
      data: {
        organization: { id: ORGANIZATION_ID },
        viewerRole: "manager",
      },
    });

    // The workspace is member-only, unlike the public detail read above.
    const forbiddenWorkspaceResponse = await request(
      `/organizations/${ORGANIZATION_ID}/workspace`,
      { headers: nonMember.headers() },
    );
    expect(forbiddenWorkspaceResponse.status).toBeGreaterThanOrEqual(400);
  });

  it("updates the organization slug and resolves the organization by it", async () => {
    const primaryManager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const operator = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });
    const newSlug = "harbourline-rentals";

    const forbiddenResponse = await request(
      `/organizations/${ORGANIZATION_ID}/slug`,
      {
        method: "PATCH",
        headers: operator.headers(),
        body: JSON.stringify({ slug: newSlug }),
      },
    );
    expect(forbiddenResponse.status).toBe(403);
    expect((await readOrganization()).slug).not.toBe(newSlug);

    const updateResponse = await request(
      `/organizations/${ORGANIZATION_ID}/slug`,
      {
        method: "PATCH",
        headers: primaryManager.headers(),
        body: JSON.stringify({ slug: newSlug }),
      },
    );
    expect(updateResponse.status).toBe(200);
    expect((await readOrganization()).slug).toBe(newSlug);

    const resolveResponse = await request(`/organizations/by-slug/${newSlug}`);
    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toMatchObject({
      data: { organizationId: ORGANIZATION_ID, canonicalSlug: newSlug },
    });
  });

  it("previews an invitation before it is accepted", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const invitedEmail = "preview-invitee@rentify.local";

    const inviteResponse = await request(
      `/organizations/${ORGANIZATION_ID}/invitations`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({ email: invitedEmail, role: "operator" }),
      },
    );
    expect(inviteResponse.status).toBe(201);

    const invite = await readOrganizationInviteJob(
      persistenceApp,
      invitedEmail,
    );

    const previewResponse = await request(
      `/organizations/invitations/${invite.input.token}`,
    );
    expect(previewResponse.status).toBe(200);
    await expect(previewResponse.json()).resolves.toMatchObject({
      data: {
        invitation: {
          organizationId: ORGANIZATION_ID,
          role: "operator",
          status: "pending",
        },
      },
    });

    const unknownTokenResponse = await request(
      "/organizations/invitations/not-a-real-token",
    );
    expect(unknownTokenResponse.status).toBeGreaterThanOrEqual(400);
  });

  it("records a rename in the audit log and restores the previous version", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const operator = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });
    const originalName = (await readOrganization()).name;

    const renameResponse = await request(`/organizations/${ORGANIZATION_ID}`, {
      method: "PATCH",
      headers: owner.headers(),
      body: JSON.stringify({ name: "Renamed For Audit" }),
    });
    expect(renameResponse.status).toBe(200);
    expect((await readOrganization()).name).toBe("Renamed For Audit");

    // Audit history is manager-only.
    const forbiddenAuditResponse = await request(
      `/organizations/${ORGANIZATION_ID}/audit`,
      { headers: operator.headers() },
    );
    expect(forbiddenAuditResponse.status).toBe(403);

    const auditResponse = await request(
      `/organizations/${ORGANIZATION_ID}/audit`,
      { headers: owner.headers() },
    );
    expect(auditResponse.status).toBe(200);
    const audit = await readData<{
      auditLogs: Array<{ id: string; action: string; restorable: boolean }>;
    }>(auditResponse);

    const renameEntry = audit.auditLogs.find(
      (entry) => entry.action === "organization.renamed" && entry.restorable,
    );
    expect(renameEntry).toBeDefined();

    const restoreResponse = await request(
      `/organizations/${ORGANIZATION_ID}/audit/${renameEntry!.id}/restore`,
      { method: "POST", headers: owner.headers() },
    );
    expect(restoreResponse.status).toBe(200);
    expect((await readOrganization()).name).toBe(originalName);
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

  it("creates, lists, and audits announcements while enforcing role visibility", async () => {
    const manager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const operator = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/announcements`,
      )}`,
      {
        method: "POST",
        headers: manager.headers(),
        body: JSON.stringify({
          title: "Quarterly roadmap",
          body: "Here is what we are shipping this quarter.",
          status: "published",
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as {
      data: { id: string; status: string };
    };
    const announcementId = createBody.data.id;
    expect(createBody.data.status).toBe("published");

    const auditEntry =
      await persistenceApp.prisma.organizationAuditLog.findFirst({
        where: {
          organizationId: ORGANIZATION_ID,
          resourceType: "announcement",
          resourceId: announcementId,
          action: "announcement.created",
        },
      });
    expect(auditEntry).not.toBeNull();

    const managerListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/announcements`,
      )}`,
      {
        method: "GET",
        headers: manager.headers(),
      },
    );
    expect(managerListResponse.status).toBe(200);
    const managerList = (await managerListResponse.json()) as {
      data: { announcements: Array<{ status: string }> };
    };
    expect(
      managerList.data.announcements.some(
        (announcement) => announcement.status === "draft",
      ),
    ).toBe(true);

    const operatorListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/announcements`,
      )}`,
      {
        method: "GET",
        headers: operator.headers(),
      },
    );
    expect(operatorListResponse.status).toBe(200);
    const operatorList = (await operatorListResponse.json()) as {
      data: { announcements: Array<{ status: string }> };
    };
    expect(operatorList.data.announcements.length).toBeGreaterThan(0);
    expect(
      operatorList.data.announcements.every(
        (announcement) => announcement.status === "published",
      ),
    ).toBe(true);

    const operatorCreateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/announcements`,
      )}`,
      {
        method: "POST",
        headers: operator.headers(),
        body: JSON.stringify({
          title: "Operator attempt",
          body: "Operators should not be able to post announcements.",
        }),
      },
    );
    expect(operatorCreateResponse.status).toBe(403);
  });

  it("creates blog posts, sanitizes HTML, and exposes only published posts publicly", async () => {
    const manager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const operator = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog-posts`,
      )}`,
      {
        method: "POST",
        headers: manager.headers(),
        body: JSON.stringify({
          title: "Our Spring Refresh",
          body: '<h2>Spring is here</h2><p>Enjoy new bookings.</p><script>alert("xss")</script>',
          excerpt: "New bookings for spring.",
          tags: ["spring", "news"],
          status: "published",
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as {
      data: { id: string; slug: string; body: string; status: string };
    };
    expect(createBody.data.status).toBe("published");
    expect(createBody.data.slug).toBe("our-spring-refresh");
    // HTML body is sanitized server-side: script tags are removed.
    expect(createBody.data.body).not.toContain("<script>");
    expect(createBody.data.body).toContain("<h2>Spring is here</h2>");
    const blogPostId = createBody.data.id;
    const publishedSlug = createBody.data.slug;

    const auditEntry =
      await persistenceApp.prisma.organizationAuditLog.findFirst({
        where: {
          organizationId: ORGANIZATION_ID,
          resourceType: "blog",
          resourceId: blogPostId,
          action: "blog.created",
        },
      });
    expect(auditEntry).not.toBeNull();

    // Public, unauthenticated list returns only published posts.
    const publicListResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog`,
      )}`,
      { method: "GET" },
    );
    expect(publicListResponse.status).toBe(200);
    const publicList = (await publicListResponse.json()) as {
      data: { posts: Array<{ slug: string; status: string }> };
    };
    expect(publicList.data.posts.length).toBeGreaterThan(0);
    expect(
      publicList.data.posts.every((post) => post.status === "published"),
    ).toBe(true);
    expect(
      publicList.data.posts.some((post) => post.slug === publishedSlug),
    ).toBe(true);

    // Public, unauthenticated single-post read by slug.
    const publicPostResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${publishedSlug}`,
      )}`,
      { method: "GET" },
    );
    expect(publicPostResponse.status).toBe(200);

    // Draft posts (seeded) are not publicly reachable by slug.
    const draftPublicResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/behind-the-scenes-preparation`,
      )}`,
      { method: "GET" },
    );
    expect(draftPublicResponse.status).toBe(404);

    // Operators cannot create blog posts.
    const operatorCreateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog-posts`,
      )}`,
      {
        method: "POST",
        headers: operator.headers(),
        body: JSON.stringify({
          title: "Operator attempt",
          body: "<p>Operators should not be able to post.</p>",
        }),
      },
    );
    expect(operatorCreateResponse.status).toBe(403);
  });

  it("updates and deletes an announcement", async () => {
    const manager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const createResponse = await request(
      `/organizations/${ORGANIZATION_ID}/announcements`,
      {
        method: "POST",
        headers: manager.headers(),
        body: JSON.stringify({
          title: "Draft notice",
          body: "This announcement starts as a draft.",
          status: "draft",
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created = await readData<{ id: string }>(createResponse);

    const updateResponse = await request(
      `/organizations/${ORGANIZATION_ID}/announcements/${created.id}`,
      {
        method: "PATCH",
        headers: manager.headers(),
        body: JSON.stringify({
          title: "Published notice",
          status: "published",
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationAnnouncement.findUniqueOrThrow({
        where: { id: created.id },
      }),
    ).toMatchObject({ title: "Published notice", status: "published" });

    const deleteResponse = await request(
      `/organizations/${ORGANIZATION_ID}/announcements/${created.id}`,
      { method: "DELETE", headers: manager.headers() },
    );
    expect(deleteResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationAnnouncement.findUnique({
        where: { id: created.id },
      }),
    ).toBeNull();
  });

  it("lists, publishes, and deletes blog posts across the owner and public feeds", async () => {
    const manager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const createResponse = await request(
      `/organizations/${ORGANIZATION_ID}/blog-posts`,
      {
        method: "POST",
        headers: manager.headers(),
        body: JSON.stringify({
          title: "Lifecycle Post",
          body: "<p>Draft content.</p>",
          excerpt: "A post that walks its whole lifecycle.",
          tags: ["lifecycle"],
          status: "draft",
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created = await readData<{ id: string }>(createResponse);

    const ownerListResponse = await request(
      `/organizations/${ORGANIZATION_ID}/blog-posts`,
      { headers: manager.headers() },
    );
    expect(ownerListResponse.status).toBe(200);
    const ownerList = await readData<{ posts: Array<{ id: string }> }>(
      ownerListResponse,
    );
    expect(ownerList.posts.map((post) => post.id)).toContain(created.id);

    // A draft must not reach the public feed.
    const draftFeed = await readData<{ posts: Array<{ id: string }> }>(
      await request("/blog"),
    );
    expect(draftFeed.posts.map((post) => post.id)).not.toContain(created.id);

    const publishResponse = await request(
      `/organizations/${ORGANIZATION_ID}/blog-posts/${created.id}`,
      {
        method: "PATCH",
        headers: manager.headers(),
        body: JSON.stringify({ title: "Published Post", status: "published" }),
      },
    );
    expect(publishResponse.status).toBe(200);

    const publicFeedResponse = await request("/blog");
    expect(publicFeedResponse.status).toBe(200);
    const publicFeed = await readData<{
      posts: Array<{ id: string; title: string }>;
    }>(publicFeedResponse);
    expect(publicFeed.posts).toContainEqual(
      expect.objectContaining({ id: created.id, title: "Published Post" }),
    );

    const deleteResponse = await request(
      `/organizations/${ORGANIZATION_ID}/blog-posts/${created.id}`,
      { method: "DELETE", headers: manager.headers() },
    );
    expect(deleteResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationBlogPost.findUnique({
        where: { id: created.id },
      }),
    ).toBeNull();
  });

  it("runs the organization review lifecycle for an eligible reviewer", async () => {
    const reviewer = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const manager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    await makeReviewerEligible(reviewer.userId);

    const createResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews`,
      {
        method: "POST",
        headers: reviewer.headers(),
        body: JSON.stringify({
          rating: 5,
          title: "Smooth end-to-end rental",
          comment: "Pickup was effortless and the team stayed responsive.",
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const review = await readData<{ id: string }>(createResponse);

    const listResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews`,
    );
    expect(listResponse.status).toBe(200);
    const list = await readData<{ reviews: Array<{ id: string }> }>(
      listResponse,
    );
    expect(list.reviews.map((entry) => entry.id)).toContain(review.id);

    const ownResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews/me`,
      { headers: reviewer.headers() },
    );
    expect(ownResponse.status).toBe(200);
    await expect(ownResponse.json()).resolves.toMatchObject({
      data: { id: review.id, rating: 5 },
    });

    const updateOwnResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews/me`,
      {
        method: "PUT",
        headers: reviewer.headers(),
        body: JSON.stringify({
          rating: 4,
          title: "Still a great experience",
          comment: "The second rental went just as smoothly as the first.",
        }),
      },
    );
    expect(updateOwnResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationReview.findUniqueOrThrow({
        where: { id: review.id },
      }),
    ).toMatchObject({ rating: 4, title: "Still a great experience" });

    const replyResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews/${review.id}/reply`,
      {
        method: "PUT",
        headers: manager.headers(),
        body: JSON.stringify({
          body: "Thank you for renting with us — see you next time!",
        }),
      },
    );
    expect(replyResponse.status).toBe(200);
    expect(
      (
        await persistenceApp.prisma.organizationReview.findUniqueOrThrow({
          where: { id: review.id },
        })
      ).response,
    ).toContain("Thank you for renting with us");

    const removeReplyResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews/${review.id}/reply`,
      { method: "DELETE", headers: manager.headers() },
    );
    expect(removeReplyResponse.status).toBe(200);
    expect(
      (
        await persistenceApp.prisma.organizationReview.findUniqueOrThrow({
          where: { id: review.id },
        })
      ).response,
    ).toBeNull();

    const deleteOwnResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews/me`,
      { method: "DELETE", headers: reviewer.headers() },
    );
    expect(deleteOwnResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationReview.findUnique({
        where: { id: review.id },
      }),
    ).toBeNull();
  });

  it("refuses reviews from members and lets a manager remove a review by id", async () => {
    const member = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const reviewer = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const manager = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const memberReviewResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews`,
      {
        method: "POST",
        headers: member.headers(),
        body: JSON.stringify({
          rating: 5,
          title: "Reviewing my own organization",
          comment: "Members must not be able to review their organization.",
        }),
      },
    );
    expect(memberReviewResponse.status).toBe(403);
    expect(
      await persistenceApp.prisma.organizationReview.count({
        where: { organizationId: ORGANIZATION_ID, reviewerId: member.userId },
      }),
    ).toBe(0);

    await makeReviewerEligible(reviewer.userId);
    const createResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews`,
      {
        method: "POST",
        headers: reviewer.headers(),
        body: JSON.stringify({
          rating: 2,
          title: "Needs improvement",
          comment: "Communication was slower than expected on this rental.",
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const review = await readData<{ id: string }>(createResponse);

    const deleteResponse = await request(
      `/organizations/${ORGANIZATION_ID}/reviews/${review.id}`,
      { method: "DELETE", headers: manager.headers() },
    );
    expect(deleteResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.organizationReview.findUnique({
        where: { id: review.id },
      }),
    ).toBeNull();
  });
});
