import {
  hashSelfLockToken,
  SELF_LOCK_CLAIM_SCRIPT,
  SELF_LOCK_RELEASE_SCRIPT,
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

/**
 * A cache that runs the store's two scripts with Redis semantics: GET plus a
 * RENAME that keeps the expiry, and a RENAMENX back.
 */
function createCache() {
  const entries = new Map<string, { value: string; ttl?: number }>();

  return {
    entries,
    setJson: jest.fn(async (key: string, value: unknown, ttl?: number) => {
      entries.set(key, { value: JSON.stringify(value), ttl });
    }),
    delete: jest.fn(async (key: string) => entries.delete(key)),
    eval: jest.fn(async <T>(script: string, keys: string[] = []) => {
      const [from, to] = keys as [string, string];
      const entry = entries.get(from);

      if (script === SELF_LOCK_CLAIM_SCRIPT) {
        if (!entry) {
          return null as T;
        }
        entries.delete(from);
        entries.set(to, entry);
        return entry.value as T;
      }

      if (script === SELF_LOCK_RELEASE_SCRIPT) {
        if (!entry || entries.has(to)) {
          return 0 as T;
        }
        entries.delete(from);
        entries.set(to, entry);
        return 1 as T;
      }

      throw new Error("Unexpected script");
    }),
  };
}

function storeFor(cache: ReturnType<typeof createCache>, ttlSeconds?: number) {
  return new SelfLockTokenStore(
    cache as unknown as SelfLockTokenCache,
    ttlSeconds,
  );
}

const key = (token: string) => `auth:self-lock:${hashSelfLockToken(token)}`;
const claimedKey = (token: string) =>
  `auth:self-lock:claimed:${hashSelfLockToken(token)}`;

describe("SelfLockTokenStore", () => {
  it("stores only the token's hash, for a day", async () => {
    const cache = createCache();

    const token = await storeFor(cache).issue(PAYLOAD);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...cache.entries.keys()]).toEqual([key(token)]);
    expect(key(token)).not.toContain(token);
    expect(cache.setJson).toHaveBeenCalledWith(
      key(token),
      PAYLOAD,
      SELF_LOCK_TOKEN_TTL_SECONDS,
    );
  });

  it("issues a different token every time", async () => {
    const store = storeFor(createCache());

    expect(await store.issue(PAYLOAD)).not.toBe(await store.issue(PAYLOAD));
  });

  it("hands a token out once, and completing it spends it", async () => {
    const cache = createCache();
    const store = storeFor(cache);
    const token = await store.issue(PAYLOAD);

    await expect(store.claim(token)).resolves.toEqual(PAYLOAD);
    await expect(store.claim(token)).resolves.toBeNull();

    await store.complete(token);

    expect(cache.entries.size).toBe(0);
  });

  it("makes a released token claimable again, with its original expiry", async () => {
    const cache = createCache();
    const store = storeFor(cache, 600);
    const token = await store.issue(PAYLOAD);
    await store.claim(token);

    await store.release(token);

    expect(cache.entries.get(key(token))).toMatchObject({ ttl: 600 });
    expect(cache.entries.has(claimedKey(token))).toBe(false);
    await expect(store.claim(token)).resolves.toEqual(PAYLOAD);
  });

  it("releases nothing once the claimed token has expired", async () => {
    const cache = createCache();
    const store = storeFor(cache);

    await store.release("long-gone");

    expect(cache.entries.size).toBe(0);
  });

  it("returns null for an unknown or empty token", async () => {
    const cache = createCache();
    const store = storeFor(cache);

    await expect(store.claim("never-issued")).resolves.toBeNull();
    await expect(store.claim("")).resolves.toBeNull();
    expect(cache.eval).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not a token payload", JSON.stringify({ userId: 7 })],
    ["not JSON", "{oops"],
  ])("spends and rejects a stored value that is %s", async (_label, value) => {
    const cache = createCache();
    const store = storeFor(cache);
    cache.entries.set(key("odd"), { value });

    await expect(store.claim("odd")).resolves.toBeNull();
    expect(cache.entries.size).toBe(0);
  });
});
