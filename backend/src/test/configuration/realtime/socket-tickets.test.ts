import {
  SocketTicketStore,
  type SocketTicketCache,
} from "@/configuration/realtime/socket-tickets";

/** A cache that keeps values in memory, with the TTL each was given. */
function createCache() {
  const entries = new Map<string, { value: unknown; ttlSeconds?: number }>();
  const getDelete = jest.fn(async (key: string): Promise<unknown> => {
    const entry = entries.get(key);
    entries.delete(key);
    return entry?.value ?? null;
  });
  const cache: SocketTicketCache = {
    setJson: async (key, value, ttlSeconds) => {
      entries.set(key, { value, ttlSeconds });
    },
    getDeleteJson: <T>(key: string) => getDelete(key) as Promise<T | null>,
  };

  return { cache, entries, getDelete };
}

describe("SocketTicketStore", () => {
  const options = { keyPrefix: "feature:ws-ticket", ttlSeconds: 30 };

  it("issues a random ticket that maps to the identity for the TTL", async () => {
    const { cache, entries } = createCache();
    const store = new SocketTicketStore<{ userId: string }>(cache, options);

    const first = await store.issue({ userId: "user-1" });
    const second = await store.issue({ userId: "user-1" });

    expect(first.expiresInSeconds).toBe(30);
    expect(first.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.ticket).not.toBe(first.ticket);
    expect(entries.get(`feature:ws-ticket:${first.ticket}`)).toEqual({
      value: { userId: "user-1" },
      ttlSeconds: 30,
    });
  });

  it("redeems a ticket once, by reading and deleting it in one operation", async () => {
    const { cache, getDelete } = createCache();
    const store = new SocketTicketStore<{ userId: string }>(cache, options);
    const { ticket } = await store.issue({ userId: "user-1" });

    await expect(store.redeem(ticket)).resolves.toEqual({ userId: "user-1" });
    await expect(store.redeem(ticket)).resolves.toBeNull();
    expect(getDelete).toHaveBeenCalledWith(`feature:ws-ticket:${ticket}`);
  });

  it("refuses a missing or unknown ticket without asking the cache for an empty one", async () => {
    const { cache, getDelete } = createCache();
    const store = new SocketTicketStore(cache, options);

    await expect(store.redeem("")).resolves.toBeNull();
    await expect(store.redeem("unknown")).resolves.toBeNull();
    expect(getDelete).toHaveBeenCalledTimes(1);
  });
});
