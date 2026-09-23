import { OAuthSignupStore } from "@/features/auth/oauth/oauth-signup.store";

describe("OAuthSignupStore", () => {
  it("stores a high-entropy continuation for ten minutes", async () => {
    const cacheService = {
      setJson: jest.fn(async () => undefined),
    };
    const store = new OAuthSignupStore(cacheService as never);
    const record = {
      profile: {
        provider: "google" as const,
        providerUserId: "provider-user",
        email: "person@example.com",
        emailVerified: true,
      },
      createdAt: "2026-09-22T00:00:00.000Z",
    };

    const token = await store.create(record);

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(cacheService.setJson).toHaveBeenCalledWith(
      `auth:oauth-signup:${token}`,
      record,
      600,
    );
    expect(store.getTtlInSeconds()).toBe(600);
  });

  it("reads, deletes, and locks the same continuation key", async () => {
    const cacheService = {
      getJson: jest.fn(async () => ({ createdAt: "now" })),
      delete: jest.fn(async () => true),
      acquireLock: jest.fn(async () => ({ release: jest.fn() })),
    };
    const store = new OAuthSignupStore(cacheService as never);

    await store.read("token-1");
    await store.delete("token-1");
    await store.acquireCompletionLock("token-1");

    expect(cacheService.getJson).toHaveBeenCalledWith(
      "auth:oauth-signup:token-1",
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      "auth:oauth-signup:token-1",
    );
    expect(cacheService.acquireLock).toHaveBeenCalledWith(
      "auth:oauth-signup:complete:token-1",
      10_000,
    );
  });
});
