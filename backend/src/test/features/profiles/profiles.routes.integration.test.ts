import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { ProfileController } from "@/features/profile/profile.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";
import { bearerHeaders } from "../../support/route-request";

function createProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    email: "user@example.com",
    username: "test-user",
    isPrivate: false,
    recommendationPersonalizationEnabled: true,
    trustworthinessScore: 4,
    rentPostingsCount: 2,
    availableRentPostingsCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createApp() {
  const profileService = {
    list: jest.fn(async () => ({
      profiles: [createProfile()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    getByUserId: jest.fn(async (userId: string) => createProfile({ userId })),
    update: jest.fn(async (input: { userId: string; username: string }) =>
      createProfile({
        userId: input.userId,
        username: input.username,
        updatedAt: "2026-06-02T00:00:00.000Z",
      }),
    ),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.profileController,
      new ProfileController(profileService as never),
    ],
    [
      containerTokens.tokenService,
      { verifyAccessToken: jest.fn(async () => createJwtClaims()) },
    ],
  ]);

  return { app: createRouteTestApp(registry), profileService };
}

describe("Profile routes integration", () => {
  it("lists profiles with pagination and a search query", async () => {
    const { app, profileService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/profiles?page=1&pageSize=20&q=test")}`,
    );

    expect(response.status).toBe(200);
    expect(profileService.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      query: "test",
    });
  });

  it("reads the signed-in user's profile", async () => {
    const { app, profileService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      { headers: bearerHeaders("user-token") },
    );

    expect(response.status).toBe(200);
    expect(profileService.getByUserId).toHaveBeenCalledWith("user-1");
  });

  it("updates the signed-in user's profile", async () => {
    const { app, profileService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        method: "PUT",
        headers: bearerHeaders("user-token"),
        body: JSON.stringify({
          username: "updated-user",
          phoneNumber: "+1 416 555 0100",
          isPrivate: false,
          recommendationPersonalizationEnabled: true,
          avatarUrl: "https://example.com/avatar.jpg",
          avatarBlobName: "avatars/user-1.jpg",
          trustworthinessScore: 4,
          rentPostingsCount: 2,
          availableRentPostingsCount: 1,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(profileService.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", username: "updated-user" }),
    );
  });

  it("rejects reading the signed-in profile without a token", async () => {
    const { app, profileService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
    );

    expect(response.status).toBe(401);
    expect(profileService.getByUserId).not.toHaveBeenCalled();
  });
});
