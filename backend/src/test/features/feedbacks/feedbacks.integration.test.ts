import { buildApiPath } from "@/configuration/http/api-path";
import { createAuthenticatedRequestContext, createPersistenceTestApp, resetPersistenceState, teardownPersistenceTestApp, type PersistenceTestApp } from "../../support/persistence-test-app";

describe("Feedbacks persistence integration", () => {
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

  it("persists anonymous feedback after captcha verification", async () => {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "feature_request",
          message: "Please add saved searches to the renter flow.",
          captchaToken: "captcha-ok-feedback",
        }),
      },
    );

    expect(response.status).toBe(201);

    const feedback = await persistenceApp.prisma.feedback.findFirst({
      where: {
        email: "taylor@example.com",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(feedback).toMatchObject({
      userId: null,
      name: "Taylor Morgan",
      email: "taylor@example.com",
      category: "feature_request",
      message: "Please add saved searches to the renter flow.",
    });
  });

  it("persists authenticated feedback with the current user id", async () => {
    const auth = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: auth.headers(),
        body: JSON.stringify({
          name: "Jordan Lee",
          email: "user1@rentify.local",
          category: "bug_report",
          message: "The contact page submits twice on mobile Safari.",
        }),
      },
    );

    expect(response.status).toBe(201);

    const feedback = await persistenceApp.prisma.feedback.findFirst({
      where: {
        userId: auth.userId,
        category: "bug_report",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(feedback).toMatchObject({
      userId: auth.userId,
      email: "user1@rentify.local",
      category: "bug_report",
    });
  });

  it("does not persist anonymous feedback when captcha verification fails", async () => {
    const beforeCount = await persistenceApp.prisma.feedback.count();

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/feedback")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Taylor Morgan",
          email: "taylor@example.com",
          category: "usability",
          message: "The saved filters disappear when navigating back.",
          captchaToken: "bad-token",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await persistenceApp.prisma.feedback.count()).toBe(beforeCount);
  });
});
