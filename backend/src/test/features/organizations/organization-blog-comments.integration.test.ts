import { buildApiPath } from "@/configuration/http/api-path";
import { createFixtureId } from "@/seeds/types";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORGANIZATION_ID = createFixtureId(1040, 1);

/**
 * The seeded published post that carries comments, and the seeded post whose
 * comments are closed. Both are addressed by slug, which is what the public
 * routes take.
 */
const OPEN_SLUG = "introducing-weekend-stays";
const CLOSED_SLUG = "five-ways-to-feel-at-home";
const DRAFT_SLUG = "behind-the-scenes-preparation";

describe("Organization blog comments persistence integration", () => {
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

  function authHeaders(accessToken: string): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    };
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

  it("serves seeded comments to an anonymous reader", async () => {
    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
    );

    expect(response.status).toBe(200);
    const data = await readData<{
      comments: Array<{ id: string; body: string; deletedBy: string | null }>;
      commentsEnabled: boolean;
      viewerCanComment: boolean;
      viewerCanModerate: boolean;
      viewerUserId: string | null;
    }>(response);

    expect(data.comments.length).toBeGreaterThan(0);
    expect(data.commentsEnabled).toBe(true);
    // Anonymous: reads everything, can do nothing.
    expect(data.viewerCanComment).toBe(false);
    expect(data.viewerCanModerate).toBe(false);
    expect(data.viewerUserId).toBeNull();
  });

  it("returns tombstones with their attribution and no body", async () => {
    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
    );
    const data = await readData<{
      comments: Array<{ body: string; deletedBy: string | null }>;
    }>(response);

    const tombstones = data.comments.filter(
      (comment) => comment.deletedBy !== null,
    );

    expect(tombstones.length).toBeGreaterThan(0);
    for (const tombstone of tombstones) {
      expect(tombstone.body).toBe("");
    }
    expect(tombstones.map((comment) => comment.deletedBy)).toEqual(
      expect.arrayContaining(["author", "moderator"]),
    );
  });

  it("never exposes a commenter's email address", async () => {
    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
    );
    const raw = await response.text();

    // The record is world-readable, unlike a booking thread.
    expect(raw).not.toContain("@rentify.local");
  });

  it("resolves capabilities for a signed-in reader", async () => {
    // Deliberately a non-member: the seeded `user1` and `user2` both hold
    // memberships in this organization, so neither can show that a plain
    // signed-in reader gets write access without moderation.
    const renter = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });

    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
      { headers: authHeaders(renter.accessToken) },
    );
    const data = await readData<{
      viewerCanComment: boolean;
      viewerCanModerate: boolean;
      viewerUserId: string | null;
    }>(response);

    expect(data.viewerCanComment).toBe(true);
    expect(data.viewerCanModerate).toBe(false);
    expect(data.viewerUserId).toBe(renter.userId);
  });

  it("resolves moderation for a manager of the owning organization", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
      { headers: authHeaders(owner.accessToken) },
    );
    const data = await readData<{ viewerCanModerate: boolean }>(response);

    expect(data.viewerCanModerate).toBe(true);
  });

  it("404s the comments of an unpublished post", async () => {
    const response = await request(
      `/organizations/${ORGANIZATION_ID}/blog/${DRAFT_SLUG}/comments`,
    );

    expect(response.status).toBe(404);
  });

  it("posts, edits and removes a comment", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const createResponse = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Posting from the integration suite." }),
      },
    );

    expect(createResponse.status).toBe(201);
    const created = await readData<{ id: string; body: string }>(
      createResponse,
    );
    expect(created.body).toBe("Posting from the integration suite.");

    const updateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`,
      )}`,
      {
        method: "PATCH",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Edited from the integration suite." }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updated = await readData<{ body: string; editedAt: string | null }>(
      updateResponse,
    );
    expect(updated.body).toBe("Edited from the integration suite.");
    expect(updated.editedAt).not.toBeNull();

    const deleteResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`,
      )}`,
      { method: "DELETE", headers: authHeaders(renter.accessToken) },
    );

    expect(deleteResponse.status).toBe(200);
    const deleted = await readData<{ body: string; deletedBy: string }>(
      deleteResponse,
    );
    // Soft delete: the row survives so the thread keeps its shape.
    expect(deleted.body).toBe("");
    expect(deleted.deletedBy).toBe("author");

    const secondDelete = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`,
      )}`,
      { method: "DELETE", headers: authHeaders(renter.accessToken) },
    );

    // Reported as missing, so a repeat cannot rewrite who removed it and when.
    expect(secondDelete.status).toBe(404);
  });

  it("rejects an anonymous write", async () => {
    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Anonymous attempt." }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects a write to a post whose comments are closed", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${CLOSED_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "This thread is closed." }),
      },
    );

    expect(response.status).toBe(409);
  });

  it("rejects a manager's write to a closed thread too", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${CLOSED_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(owner.accessToken),
        body: JSON.stringify({ body: "Managers are not exempt." }),
      },
    );

    expect(response.status).toBe(409);
  });

  it("rejects a body carrying markup", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "<script>alert(1)</script>" }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("lets a manager remove someone else's comment", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Something a manager will remove." }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    const deleteResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`,
      )}`,
      { method: "DELETE", headers: authHeaders(owner.accessToken) },
    );

    expect(deleteResponse.status).toBe(200);
    const deleted = await readData<{ deletedBy: string }>(deleteResponse);
    expect(deleted.deletedBy).toBe("moderator");
  });

  it("stops a manager rewriting someone else's comment", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Only I may edit this." }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    const updateResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`,
      )}`,
      {
        method: "PATCH",
        headers: authHeaders(owner.accessToken),
        body: JSON.stringify({ body: "Words in someone else's mouth." }),
      },
    );

    // Managers remove; they do not rewrite.
    expect(updateResponse.status).toBe(403);
  });

  it("stops an unrelated user removing a comment", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const other = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Not yours to remove." }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    const deleteResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments/${created.id}`,
      )}`,
      { method: "DELETE", headers: authHeaders(other.accessToken) },
    );

    expect(deleteResponse.status).toBe(403);
  });

  it("issues an anonymous socket ticket as a scoped cookie", async () => {
    const response = await request(
      "/organizations/00000000-0000-0000-1040-000000000001/blog/introducing-weekend-stays/comments/socket-ticket",
      { method: "POST" },
    );

    expect(response.status).toBe(201);
    const data = await readData<{ expiresInSeconds: number }>(response);
    expect(data.expiresInSeconds).toBe(30);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("rentify_blog_ws_ticket=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/ws/blog-comments");
  });

  it("refuses to issue a ticket for an unpublished post", async () => {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${DRAFT_SLUG}/comments/socket-ticket`,
      )}`,
      { method: "POST" },
    );

    // A draft has no stream at all, enforced before any connection exists.
    expect(response.status).toBe(404);
  });

  it("closes and reopens comments through the blog management route", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const post =
      await persistenceApp.prisma.organizationBlogPost.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, slug: OPEN_SLUG },
      });

    const closeResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog-posts/${post.id}`,
      )}`,
      {
        method: "PATCH",
        headers: authHeaders(owner.accessToken),
        body: JSON.stringify({ commentsEnabled: false }),
      },
    );

    expect(closeResponse.status).toBe(200);
    const closed = await readData<{ commentsEnabled: boolean }>(closeResponse);
    expect(closed.commentsEnabled).toBe(false);

    const blockedResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Should be refused." }),
      },
    );

    expect(blockedResponse.status).toBe(409);
  });

  it("reports a comment through the content report pipeline", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const reporter = await createAuthenticatedRequestContext({
      email: "user2@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "Buy cheap followers at example.test" }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    const reportResponse = await request("/reports", {
      method: "POST",
      headers: authHeaders(reporter.accessToken),
      body: JSON.stringify({
        subjectType: "organization_blog_comment",
        subjectId: created.id,
        reasonCode: "spam",
        title: "Spam comment",
        description:
          "This comment is advertising a follower-selling service on a public post.",
      }),
    });

    expect(reportResponse.status).toBe(201);
    const report = await readData<{
      subjectType: string;
      subjectId: string;
    }>(reportResponse);
    expect(report.subjectType).toBe("organization_blog_comment");
    expect(report.subjectId).toBe(created.id);
  });

  it("refuses a self-report", async () => {
    const renter = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(
        `/organizations/${ORGANIZATION_ID}/blog/${OPEN_SLUG}/comments`,
      )}`,
      {
        method: "POST",
        headers: authHeaders(renter.accessToken),
        body: JSON.stringify({ body: "My own comment." }),
      },
    );
    const created = await readData<{ id: string }>(createResponse);

    const reportResponse = await request("/reports", {
      method: "POST",
      headers: authHeaders(renter.accessToken),
      body: JSON.stringify({
        subjectType: "organization_blog_comment",
        subjectId: created.id,
        reasonCode: "spam",
        title: "Spam comment",
        description:
          "This is an invalid self-report attempt against my own comment.",
      }),
    });

    expect(reportResponse.status).toBe(403);
  });
});
