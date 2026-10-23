import {
  hashSelfLockToken,
  SelfLockTokenStore,
  type SelfLockTokenCache,
} from "@/features/auth/self-lock/self-lock-token.store";
import { SELF_LOCK_TOKEN_TTL_SECONDS } from "@/features/auth/self-lock/self-lock.model";
import { asUuid } from "@/configuration/validation/uuid";
import { testUuid } from "../../../support/uuid";

const PAYLOAD = {
  userId: asUuid(testUuid(9000, 378101)),
  sourceEventId: asUuid(testUuid(9000, 378102)),
};

/** A cache with real GETDEL semantics, so single use is actually exercised. */
function createCache() {
  const entries = new Map<string, { value: string; ttl?: number }>();

  return {
    entries,
    setJson: jest.fn(async (key: string, value: unknown, ttl?: number) => {
      entries.set(key, { value: JSON.stringify(value), ttl });
    }),
    getDeleteJson: jest.fn(async <T>(key: string): Promise<T | null> => {
      const entry = entries.get(key);
      entries.delete(key);
      return entry ? (JSON.parse(entry.value) as T) : null;
    }),
  };
}

function storeFor(cache: ReturnType<typeof createCache>, ttlSeconds?: number) {
  return new SelfLockTokenStore(
    cache as unknown as SelfLockTokenCache,
    ttlSeconds,
  );
}

describe("SelfLockTokenStore", () => {
  it("stores only the token's hash, for a day", async () => {
    const cache = createCache();
    const store = storeFor(cache);

    const token = await store.issue(PAYLOAD);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...cache.entries.keys()]).toEqual([
      `auth:self-lock:${hashSelfLockToken(token)}`,
    ]);
    expect([...cache.entries.keys()][0]).not.toContain(token);
    expect(cache.setJson).toHaveBeenCalledWith(
      expect.any(String),
      PAYLOAD,
      SELF_LOCK_TOKEN_TTL_SECONDS,
    );
  });

  it("issues a different token every time", async () => {
    const store = storeFor(createCache());

    const first = await store.issue(PAYLOAD);
    const second = await store.issue(PAYLOAD);

    expect(first).not.toBe(second);
  });

  it("returns the payload once, then nothing", async () => {
    const store = storeFor(createCache());
    const token = await store.issue(PAYLOAD);

    await expect(store.consume(token)).resolves.toEqual(PAYLOAD);
    await expect(store.consume(token)).resolves.toBeNull();
  });

  it("returns null for an unknown, empty or expired token", async () => {
    const cache = createCache();
    const store = storeFor(cache);

    await expect(store.consume("never-issued")).resolves.toBeNull();
    await expect(store.consume("")).resolves.toBeNull();
    expect(cache.getDeleteJson).toHaveBeenCalledTimes(1);
  });

  it("returns null for a stored value that is not a token payload", async () => {
    const cache = createCache();
    const store = storeFor(cache);
    cache.entries.set(`auth:self-lock:${hashSelfLockToken("odd")}`, {
      value: JSON.stringify({ userId: 7 }),
    });

    await expect(store.consume("odd")).resolves.toBeNull();
  });

  it("honours a custom lifetime", async () => {
    const cache = createCache();

    await storeFor(cache, 60).issue(PAYLOAD);

    expect(cache.setJson).toHaveBeenCalledWith(expect.any(String), PAYLOAD, 60);
  });
});
