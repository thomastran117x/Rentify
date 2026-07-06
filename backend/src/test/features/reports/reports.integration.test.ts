import { buildApiPath } from "@/configuration/http/api-path";
import { SEED_POSTINGS } from "@/seeds/fixtures/postings";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

describe("Reports persistence integration", () => {
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

  it("persists created reports for authenticated users", async () => {
    const reporter = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });
    const postingId = SEED_POSTINGS[0]!.id;

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/reports")}`,
      {
        method: "POST",
        headers: reporter.headers(),
        body: JSON.stringify({
          subjectType: "posting",
          subjectId: postingId,
          reasonCode: "spam",
          title: "Looks suspicious",
          description: "This listing asks for payment outside the platform.",
        }),
      },
    );

    expect(response.status).toBe(201);

    const report = await persistenceApp.prisma.contentReport.findFirst({
      where: {
        reporterId: reporter.userId,
        subjectId: postingId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(report).toMatchObject({
      reporterId: reporter.userId,
      subjectType: "posting",
      subjectId: postingId,
      reasonCode: "spam",
      status: "open",
    });
  });

  it("persists report assignment and status transitions", async () => {
    const reporter = await createAuthenticatedRequestContext({
      email: "viewer1@rentify.local",
    });
    const moderator = await createAuthenticatedRequestContext({
      email: "moderator1@rentify.local",
    });
    const postingId = SEED_POSTINGS[0]!.id;

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/reports")}`,
      {
        method: "POST",
        headers: reporter.headers(),
        body: JSON.stringify({
          subjectType: "posting",
          subjectId: postingId,
          reasonCode: "fraud_or_scam",
          title: "Fake listing",
          description: "The listing is requesting an off-platform deposit.",
        }),
      },
    );

    expect(createResponse.status).toBe(201);

    const createdReport =
      await persistenceApp.prisma.contentReport.findFirstOrThrow({
        where: {
          reporterId: reporter.userId,
          subjectId: postingId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    const assignResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/moderation/reports/${createdReport.id}/assignment`)}`,
      {
        method: "POST",
        headers: moderator.headers(),
        body: JSON.stringify({
          assignedModeratorId: moderator.userId,
        }),
      },
    );
    const statusResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/moderation/reports/${createdReport.id}/status`)}`,
      {
        method: "POST",
        headers: moderator.headers(),
        body: JSON.stringify({
          status: "under_review",
          note: "Escalating for manual review.",
        }),
      },
    );

    expect(assignResponse.status).toBe(200);
    expect(statusResponse.status).toBe(200);

    const updatedReport =
      await persistenceApp.prisma.contentReport.findUniqueOrThrow({
        where: {
          id: createdReport.id,
        },
      });
    const events = await persistenceApp.prisma.contentReportEvent.findMany({
      where: {
        reportId: createdReport.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(updatedReport).toMatchObject({
      id: createdReport.id,
      assignedModeratorId: moderator.userId,
      status: "under_review",
    });
    expect(events.some((event) => event.eventType === "assigned")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.toStatus === "under_review" &&
          ["status_changed", "note_added"].includes(event.eventType),
      ),
    ).toBe(true);
  });

  it("does not persist owner self-report attempts against their own posting", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const postingId = SEED_POSTINGS[0]!.id;
    const beforeCount = await persistenceApp.prisma.contentReport.count();

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/reports")}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          subjectType: "posting",
          subjectId: postingId,
          reasonCode: "spam",
          title: "Should fail",
          description: "Owners should not be able to report their own posting.",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await persistenceApp.prisma.contentReport.count()).toBe(beforeCount);
  });
});
