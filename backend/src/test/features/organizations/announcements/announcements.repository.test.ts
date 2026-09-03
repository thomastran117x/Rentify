import { OrganizationAnnouncementRepository } from "@/features/organizations/announcements/announcements.repository";
import { testUuid } from "../../../support/uuid";
const ANNOUNCEMENT_1_ID = testUuid(9000, 478450);
const MISSING_ID = testUuid(9000, 394917);

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ANNOUNCEMENT_1_ID,
    organizationId: ORG_1_ID,
    author: {
      id: USER_1_ID,
      email: "owner@example.com",
      profile: {
        username: "owner-one",
        avatarUrl: "https://example.test/avatar.png",
      },
    },
    title: "Announcement title",
    body: "Announcement body",
    status: "published",
    publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("OrganizationAnnouncementRepository", () => {
  it("creates and maps an announcement", async () => {
    const create = jest.fn(async () => buildRow());
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { create },
    } as never);

    const result = await repository.create({
      organizationId: ORG_1_ID,
      authorUserId: USER_1_ID,
      title: "Announcement title",
      body: "Announcement body",
      status: "published",
      publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_1_ID,
          authorUserId: USER_1_ID,
          status: "published",
        }),
      }),
    );
    expect(result).toEqual({
      id: ANNOUNCEMENT_1_ID,
      organizationId: ORG_1_ID,
      author: {
        id: USER_1_ID,
        email: "owner@example.com",
        username: "owner-one",
        avatarUrl: "https://example.test/avatar.png",
      },
      title: "Announcement title",
      body: "Announcement body",
      status: "published",
      publishedAt: "2026-07-16T00:00:00.000Z",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
  });

  it("maps a draft announcement without an author or published date", async () => {
    const findFirst = jest.fn(async () =>
      buildRow({ author: null, status: "draft", publishedAt: null }),
    );
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { findFirst },
    } as never);

    const result = await repository.findById(ORG_1_ID, ANNOUNCEMENT_1_ID);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ANNOUNCEMENT_1_ID, organizationId: ORG_1_ID },
      }),
    );
    expect(result?.author).toBeUndefined();
    expect(result?.publishedAt).toBeUndefined();
    expect(result?.status).toBe("draft");
  });

  it("returns null when an announcement is not found", async () => {
    const findFirst = jest.fn(async () => null);
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { findFirst },
    } as never);

    await expect(repository.findById(ORG_1_ID, MISSING_ID)).resolves.toBeNull();
  });

  it("updates only the provided fields", async () => {
    const update = jest.fn(async () => buildRow({ title: "Updated" }));
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { update },
    } as never);

    await repository.update(ORG_1_ID, ANNOUNCEMENT_1_ID, { title: "Updated" });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ANNOUNCEMENT_1_ID, organizationId: ORG_1_ID },
        data: { title: "Updated" },
      }),
    );
  });

  it("deletes an announcement scoped to its organization", async () => {
    const deleteFn = jest.fn(async () => buildRow());
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { delete: deleteFn },
    } as never);

    await repository.delete(ORG_1_ID, ANNOUNCEMENT_1_ID);

    expect(deleteFn).toHaveBeenCalledWith({
      where: { id: ANNOUNCEMENT_1_ID, organizationId: ORG_1_ID },
    });
  });

  it("filters by an explicit status and paginates", async () => {
    const findMany = jest.fn(async () => [buildRow()]);
    const count = jest.fn(async () => 1);
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { findMany, count },
    } as never);

    const result = await repository.list({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      page: 2,
      pageSize: 1,
      status: "published",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_1_ID, status: { in: ["published"] } },
        skip: 1,
        take: 1,
      }),
    );
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 1,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(result.announcements).toHaveLength(1);
  });

  it("applies the statuses filter when provided", async () => {
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { findMany, count },
    } as never);

    await repository.list({
      organizationId: ORG_1_ID,
      actorUserId: USER_1_ID,
      page: 1,
      pageSize: 20,
      statuses: ["published"],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_1_ID, status: { in: ["published"] } },
      }),
    );
  });
});
