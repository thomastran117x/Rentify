import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import {
  MAX_SAVED_SEARCHES_PER_USER,
} from "@/features/saved-searches/saved-searches.model";
import { SavedSearchesService } from "@/features/saved-searches/saved-searches.service";

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "ss-1",
    userId: "user-1",
    name: "Camera Search",
    searchParams: { family: "equipment" },
    alertEnabled: true,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function createService(repositoryOverrides: Record<string, unknown> = {}) {
  const repository = {
    create: jest.fn(async () => makeRecord()),
    findByUser: jest.fn(async () => [makeRecord()]),
    findById: jest.fn(async () => makeRecord()),
    update: jest.fn(async () => makeRecord()),
    delete: jest.fn(async () => undefined),
    countByUser: jest.fn(async () => 0),
    ...repositoryOverrides,
  };
  const service = new SavedSearchesService(repository as never);

  return { service, repository };
}

describe("SavedSearchesService", () => {
  describe("create", () => {
    it("creates a saved search when under the per-user cap", async () => {
      const { service, repository } = createService({
        countByUser: jest.fn(async () => 5),
        create: jest.fn(async () =>
          makeRecord({ name: "My Search", alertEnabled: false }),
        ),
      });

      const result = await service.create("user-1", {
        name: "My Search",
        searchParams: { family: "equipment" },
        alertEnabled: false,
      });

      expect(repository.countByUser).toHaveBeenCalledWith("user-1");
      expect(repository.create).toHaveBeenCalledWith("user-1", {
        name: "My Search",
        searchParams: { family: "equipment" },
        alertEnabled: false,
      });
      expect(result.name).toBe("My Search");
    });

    it(`throws ConflictError when user already has ${MAX_SAVED_SEARCHES_PER_USER} saved searches`, async () => {
      const { service } = createService({
        countByUser: jest.fn(async () => MAX_SAVED_SEARCHES_PER_USER),
      });

      await expect(
        service.create("user-1", {
          name: "One Too Many",
          searchParams: {},
          alertEnabled: true,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("list", () => {
    it("returns all saved searches for the user", async () => {
      const records = [makeRecord(), makeRecord({ id: "ss-2" })];
      const { service, repository } = createService({
        findByUser: jest.fn(async () => records),
      });

      const result = await service.list("user-1");

      expect(repository.findByUser).toHaveBeenCalledWith("user-1");
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates the saved search when the user owns it", async () => {
      const updated = makeRecord({ name: "Renamed", alertEnabled: false });
      const { service, repository } = createService({
        findById: jest.fn(async () => makeRecord()),
        update: jest.fn(async () => updated),
      });

      const result = await service.update("user-1", "ss-1", {
        name: "Renamed",
        alertEnabled: false,
      });

      expect(repository.findById).toHaveBeenCalledWith("ss-1");
      expect(repository.update).toHaveBeenCalledWith("ss-1", {
        name: "Renamed",
        alertEnabled: false,
      });
      expect(result.name).toBe("Renamed");
    });

    it("throws ResourceNotFoundError when the saved search does not exist", async () => {
      const { service } = createService({
        findById: jest.fn(async () => null),
      });

      await expect(
        service.update("user-1", "missing", { name: "New" }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("throws ForbiddenError when a different user attempts the update", async () => {
      const { service } = createService({
        findById: jest.fn(async () => makeRecord({ userId: "owner-user" })),
      });

      await expect(
        service.update("attacker", "ss-1", { name: "Hijacked" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("delete", () => {
    it("deletes the saved search when the user owns it", async () => {
      const { service, repository } = createService({
        findById: jest.fn(async () => makeRecord()),
        delete: jest.fn(async () => undefined),
      });

      await service.delete("user-1", "ss-1");

      expect(repository.delete).toHaveBeenCalledWith("ss-1");
    });

    it("throws ResourceNotFoundError when the saved search does not exist", async () => {
      const { service } = createService({
        findById: jest.fn(async () => null),
      });

      await expect(service.delete("user-1", "missing")).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("throws ForbiddenError when a different user attempts the delete", async () => {
      const { service } = createService({
        findById: jest.fn(async () => makeRecord({ userId: "owner-user" })),
      });

      await expect(
        service.delete("attacker", "ss-1"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
