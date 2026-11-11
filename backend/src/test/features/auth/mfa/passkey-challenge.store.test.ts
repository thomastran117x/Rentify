import { createHash } from "node:crypto";
import { PasskeyChallengeStore } from "@/features/auth/mfa/passkey/passkey-challenge.store";
import { PASSKEY_CHALLENGE_TTL_SECONDS } from "@/features/auth/mfa/passkey/passkey.model";
import { createInMemoryCache } from "../../../support/in-memory-cache";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 465001);

function createStore() {
  const cache = createInMemoryCache();
  return { cache, store: new PasskeyChallengeStore(cache as never) };
}

describe("PasskeyChallengeStore", () => {
  it("keys a challenge by purpose and a hash of its binding, for 5 minutes", async () => {
    const { cache, store } = createStore();

    await store.issue("register", "user:session", {
      challenge: "abc",
      userId: USER_ID,
    });

    const key = `auth:webauthn:register:${createHash("sha256").update("user:session").digest("hex")}`;
    expect([...cache.values.keys()]).toEqual([key]);
    expect(cache.ttls.get(key)).toBe(PASSKEY_CHALLENGE_TTL_SECONDS);
    expect(JSON.parse(cache.values.get(key)!)).toMatchObject({
      challenge: "abc",
      userId: USER_ID,
      createdAt: expect.any(String),
    });
  });

  it("is single-use", async () => {
    const { store } = createStore();
    await store.issue("login", "token", { challenge: "abc", userId: USER_ID });

    await expect(store.consume("login", "token")).resolves.toMatchObject({
      challenge: "abc",
    });
    await expect(store.consume("login", "token")).resolves.toBeNull();
  });

  it("keeps purposes apart", async () => {
    const { store } = createStore();
    await store.issue("register", "same", {
      challenge: "abc",
      userId: USER_ID,
    });

    await expect(store.consume("step-up", "same")).resolves.toBeNull();
    await expect(store.consume("register", "same")).resolves.not.toBeNull();
  });

  it("replaces an earlier challenge for the same binding", async () => {
    const { store } = createStore();
    await store.issue("step-up", "b", { challenge: "first", userId: USER_ID });
    await store.issue("step-up", "b", { challenge: "second", userId: USER_ID });

    await expect(store.consume("step-up", "b")).resolves.toMatchObject({
      challenge: "second",
    });
  });

  it("never stores a TTL below one second", async () => {
    const { cache, store } = createStore();

    await store.issue("login", "t", { challenge: "abc", userId: USER_ID }, 0.4);

    expect([...cache.ttls.values()]).toEqual([1]);
  });
});
