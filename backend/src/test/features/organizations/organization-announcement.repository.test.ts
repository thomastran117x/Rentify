import { OrganizationAnnouncementRepository } from "@/features/organizations/organization-announcement.repository";

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "announcement-1",
    organizationId: "org-1",
    author: {
      id: "user-1",
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
      organizationId: "org-1",
      authorUserId: "user-1",
      title: "Announcement title",
      body: "Announcement body",
      status: "published",
      publishedAt: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          authorUserId: "user-1",
          status: "published",
        }),
      }),
    );
    expect(result).toEqual({
      id: "announcement-1",
      organizationId: "org-1",
      author: {
        id: "user-1",
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

    const result = await repository.findById("org-1", "announcement-1");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "announcement-1", organizationId: "org-1" },
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

    await expect(repository.findById("org-1", "missing")).resolves.toBeNull();
  });

  it("updates only the provided fields", async () => {
    const update = jest.fn(async () => buildRow({ title: "Updated" }));
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { update },
    } as never);

    await repository.update("org-1", "announcement-1", { title: "Updated" });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "announcement-1", organizationId: "org-1" },
        data: { title: "Updated" },
      }),
    );
  });

  it("deletes an announcement scoped to its organization", async () => {
    const deleteFn = jest.fn(async () => buildRow());
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { delete: deleteFn },
    } as never);

    await repository.delete("org-1", "announcement-1");

    expect(deleteFn).toHaveBeenCalledWith({
      where: { id: "announcement-1", organizationId: "org-1" },
    });
  });

  it("filters by an explicit status and paginates", async () => {
    const findMany = jest.fn(async () => [buildRow()]);
    const count = jest.fn(async () => 1);
    const repository = new OrganizationAnnouncementRepository({
      organizationAnnouncement: { findMany, count },
    } as never);

    const result = await repository.list({
      organizationId: "org-1",
      actorUserId: "user-1",
      page: 2,
      pageSize: 1,
      status: "published",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", status: { in: ["published"] } },
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
      organizationId: "org-1",
      actorUserId: "user-1",
      page: 1,
      pageSize: 20,
      statuses: ["published"],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", status: { in: ["published"] } },
      }),
    );
  });
});
