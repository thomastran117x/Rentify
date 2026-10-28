import { createHash } from "node:crypto";
import { LoginMfaChallengeStore } from "@/features/auth/mfa/login/login-mfa-challenge.store";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

function keyFor(token: string): string {
  return `auth:login-mfa:${createHash("sha256").update(token).digest("hex")}`;
}

const challenge = {
  userId: USER_1_ID,
  method: "password" as const,
  username: "test-user",
  identifierHash: "hash:test-user",
  deviceId: "device-1",
  rememberMe: true,
  tokenVersion: 3,
};

describe("LoginMfaChallengeStore", () => {
  it("issues a high-entropy challenge stored only under its hash for five minutes", async () => {
    const cacheService = { setJson: jest.fn(async () => undefined) };
    const store = new LoginMfaChallengeStore(cacheService as never);

    const result = await store.issue(challenge);

    expect(result).toEqual({
      mfaRequired: true,
      mfaChallengeToken: expect.any(String),
      availableFactors: ["totp"],
      expiresInSeconds: 300,
    });
    expect(result.mfaChallengeToken.length).toBeGreaterThanOrEqual(40);
    expect(cacheService.setJson).toHaveBeenCalledWith(
      keyFor(result.mfaChallengeToken),
      { ...challenge, createdAt: expect.any(String) },
      300,
    );
    expect(JSON.stringify(cacheService.setJson.mock.calls)).not.toContain(
      result.mfaChallengeToken,
    );
    expect(store.getTtlInSeconds()).toBe(300);
  });

  it("issues a different token every time", async () => {
    const store = new LoginMfaChallengeStore({
      setJson: jest.fn(async () => undefined),
    } as never);

    const first = await store.issue(challenge);
    const second = await store.issue(challenge);

    expect(first.mfaChallengeToken).not.toBe(second.mfaChallengeToken);
  });

  it("reads, deletes and locks by the hashed key", async () => {
    const cacheService = {
      getJson: jest.fn(async () => null),
      delete: jest.fn(async () => true),
      acquireLock: jest.fn(async () => ({ release: jest.fn() })),
    };
    const store = new LoginMfaChallengeStore(cacheService as never);
    const hash = keyFor("token-1").slice("auth:login-mfa:".length);

    await store.read("token-1");
    await store.delete("token-1");
    await store.acquireCompletionLock("token-1");

    expect(cacheService.getJson).toHaveBeenCalledWith(keyFor("token-1"));
    expect(cacheService.delete).toHaveBeenCalledWith(keyFor("token-1"));
    expect(cacheService.acquireLock).toHaveBeenCalledWith(
      `auth:login-mfa:complete:${hash}`,
      10_000,
    );
  });
});
