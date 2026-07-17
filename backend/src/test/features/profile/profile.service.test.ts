import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  ProfileRecord,
  PublicProfileRecord,
} from "@/features/profile/profile.model";
import { ProfileService } from "@/features/profile/profile.service";

function createProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: "profile-1",
    userId: "user-1",
    email: "user@example.com",
    firstName: "Casey",
    lastName: "Doe",
    username: "casey-doe",
    phoneNumber: "+1 555 0100",
    avatarUrl: "https://storage.example.com/avatars/user-1.png",
    avatarBlobName: "avatars/user-1.png",
    isPrivate: false,
    recommendationPersonalizationEnabled: true,
    trustworthinessScore: 4,
    rentPostingsCount: 3,
    availableRentPostingsCount: 2,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createPublicProfile(
  overrides: Partial<PublicProfileRecord> = {},
): PublicProfileRecord {
  return {
    id: "profile-1",
    userId: "user-1",
    email: "user@example.com",
    firstName: "Casey",
    lastName: "Doe",
    username: "casey-doe",
    phoneNumber: "+1 555 0100",
    avatarUrl: "https://storage.example.com/avatars/user-1.png",
    trustworthinessScore: 4,
    rentPostingsCount: 3,
    availableRentPostingsCount: 2,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createService(options?: {
  findByUserId?: jest.Mock;
  update?: jest.Mock;
  findPublicProfiles?: jest.Mock;
  isConfigured?: jest.Mock;
  isManagedBlobUrl?: jest.Mock;
}) {
  const profileRepository = {
    findPublicProfiles:
      options?.findPublicProfiles ??
      jest.fn(async () => ({
        profiles: [createPublicProfile()],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      })),
    findByUserId: options?.findByUserId ?? jest.fn(async () => createProfile()),
    update: options?.update ?? jest.fn(async () => createProfile()),
  };
  const blobService = {
    isConfigured: options?.isConfigured ?? jest.fn(() => true),
    isManagedBlobUrl: options?.isManagedBlobUrl ?? jest.fn(() => true),
  };

  return {
    profileRepository,
    blobService,
    service: new ProfileService(
      profileRepository as any,
      blobService as any,
    ),
  };
}

describe("ProfileService", () => {
  it("trims profile list queries and omits blank search strings", async () => {
    const { service, profileRepository } = createService();

    await service.list({
      page: 2,
      pageSize: 5,
      query: "  northwind  ",
    });
    await service.list({
      page: 1,
      pageSize: 10,
      query: "   ",
    });

    expect(profileRepository.findPublicProfiles).toHaveBeenNthCalledWith(1, {
      page: 2,
      pageSize: 5,
      query: "northwind",
    });
    expect(profileRepository.findPublicProfiles).toHaveBeenNthCalledWith(2, {
      page: 1,
      pageSize: 10,
      query: undefined,
    });
  });

  it("throws ResourceNotFoundError when reading a missing profile", async () => {
    const { service } = createService({
      findByUserId: jest.fn(async () => null),
    });

    await expect(service.getByUserId("missing-user")).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("returns the resolved profile when reading by user id", async () => {
    const expectedProfile = createProfile({
      userId: "user-42",
    });
    const { service } = createService({
      findByUserId: jest.fn(async () => expectedProfile),
    });

    await expect(service.getByUserId("user-42")).resolves.toBe(expectedProfile);
  });

  it("normalizes profile updates before saving", async () => {
    const updatedProfile = createProfile({
      username: "owner-one",
      phoneNumber: "+1 555 0111",
      avatarUrl: "https://storage.example.com/avatars/user-1-updated.png",
      avatarBlobName: "avatars/user-1-updated.png",
    });
    const update = jest.fn(async () => updatedProfile);
    const { service, profileRepository, blobService } = createService({
      update,
    });

    await expect(
      service.update({
        userId: "user-1",
        username: "  Owner-One  ",
        phoneNumber: "  +1 555 0111  ",
        isPrivate: true,
        avatarUrl: "  https://storage.example.com/avatars/user-1-updated.png  ",
        avatarBlobName: "  avatars/user-1-updated.png  ",
        recommendationPersonalizationEnabled: false,
        trustworthinessScore: 5,
        rentPostingsCount: 6,
        availableRentPostingsCount: 4,
      }),
    ).resolves.toEqual(updatedProfile);

    expect(profileRepository.findByUserId).toHaveBeenCalledWith("user-1");
    expect(blobService.isConfigured).toHaveBeenCalledTimes(1);
    expect(blobService.isManagedBlobUrl).toHaveBeenCalledWith(
      "  https://storage.example.com/avatars/user-1-updated.png  ",
      "  avatars/user-1-updated.png  ",
    );
    expect(update).toHaveBeenCalledWith({
      userId: "user-1",
      username: "owner-one",
      phoneNumber: "+1 555 0111",
      isPrivate: true,
      avatarUrl: "https://storage.example.com/avatars/user-1-updated.png",
      avatarBlobName: "avatars/user-1-updated.png",
      recommendationPersonalizationEnabled: false,
      trustworthinessScore: 5,
      rentPostingsCount: 6,
      availableRentPostingsCount: 4,
    });
  });

  it("rejects updates when available postings exceed the total count", async () => {
    const { service } = createService();

    await expect(
      service.update({
        userId: "user-1",
        username: "owner-one",
        rentPostingsCount: 1,
        availableRentPostingsCount: 2,
      }),
    ).rejects.toMatchObject({
      message:
        "Available rent postings count cannot exceed total rent postings count.",
    });
  });

  it("rejects updates when only one avatar field is provided", async () => {
    const { service } = createService();

    await expect(
      service.update({
        userId: "user-1",
        username: "owner-one",
        avatarUrl: "https://storage.example.com/avatars/user-1.png",
      }),
    ).rejects.toMatchObject({
      message:
        "Avatar URL and avatar blob name must be provided together when updating the avatar.",
    });
  });

  it("rejects updates when only the avatar blob name is provided", async () => {
    const { service } = createService();

    await expect(
      service.update({
        userId: "user-1",
        username: "owner-one",
        avatarUrl: null,
        avatarBlobName: "avatars/user-1.png",
      }),
    ).rejects.toMatchObject({
      message:
        "Avatar URL and avatar blob name must both be set or both be null.",
    });
  });

  it("allows clearing avatar fields together without blob storage checks", async () => {
    const update = jest.fn(async () =>
      createProfile({
        avatarUrl: undefined,
        avatarBlobName: undefined,
      }),
    );
    const { service, blobService } = createService({
      update,
      isConfigured: jest.fn(() => false),
    });

    await service.update({
      userId: "user-1",
      username: "owner-one",
      avatarUrl: null,
      avatarBlobName: null,
    });

    expect(blobService.isConfigured).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      userId: "user-1",
      username: "owner-one",
      avatarUrl: null,
      avatarBlobName: null,
      phoneNumber: null,
    });
  });

  it("rejects avatar uploads when blob storage is not configured", async () => {
    const { service } = createService({
      isConfigured: jest.fn(() => false),
    });

    await expect(
      service.update({
        userId: "user-1",
        username: "owner-one",
        avatarUrl: "https://storage.example.com/avatars/user-1.png",
        avatarBlobName: "avatars/user-1.png",
      }),
    ).rejects.toMatchObject({
      message:
        "Avatar images require Azure Blob Storage to be configured on the backend.",
    });
  });

  it("rejects avatar urls that do not match the managed blob location", async () => {
    const { service } = createService({
      isManagedBlobUrl: jest.fn(() => false),
    });

    await expect(
      service.update({
        userId: "user-1",
        username: "owner-one",
        avatarUrl: "https://cdn.example.com/avatars/user-1.png",
        avatarBlobName: "avatars/user-1.png",
      }),
    ).rejects.toMatchObject({
      message:
        "Avatar URL must match the Azure Blob Storage location for the provided blob name.",
    });
  });

  it("throws ResourceNotFoundError when updating a missing profile", async () => {
    const { service } = createService({
      findByUserId: jest.fn(async () => null),
    });

    await expect(
      service.update({
        userId: "missing-user",
        username: "owner-one",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
