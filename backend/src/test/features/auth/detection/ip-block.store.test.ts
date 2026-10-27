import { AuthIpBlockStore } from "@/features/auth/detection/ip-block.store";

function createCache() {
  return {
    set: jest.fn(async () => undefined),
    ttl: jest.fn(async () => -2),
    delete: jest.fn(async () => true),
    scanKeys: jest.fn(async (): Promise<string[]> => []),
    mget: jest.fn(async (): Promise<Array<string | null>> => []),
  };
}

describe("AuthIpBlockStore", () => {
  it("blocks an address until a time, as a key that expires with it", async () => {
    const cache = createCache();
    const store = new AuthIpBlockStore(cache);

    await expect(
      store.block("2001:DB8::1", 3600, new Date("2026-10-26T12:00:00.000Z")),
    ).resolves.toEqual({
      ipAddress: "2001:DB8::1",
      expiresAt: "2026-10-26T13:00:00.000Z",
    });
    expect(cache.set).toHaveBeenCalledWith(
      "auth:ip-block:2001:db8::1",
      "2026-10-26T13:00:00.000Z",
      3600,
    );
  });

  it("defaults the block's start to now", async () => {
    const cache = createCache();
    const before = Date.now();

    const block = await new AuthIpBlockStore(cache).block("203.0.113.1", 60);

    expect(Date.parse(block.expiresAt)).toBeGreaterThanOrEqual(before + 60_000);
  });

  it.each([
    [1800, 1800],
    [-2, 0],
    [-1, 0],
    [0, 0],
  ])("reads a TTL of %d as %d seconds remaining", async (ttl, remaining) => {
    const cache = createCache();
    cache.ttl.mockResolvedValue(ttl);

    await expect(
      new AuthIpBlockStore(cache).getRemainingSeconds("203.0.113.1"),
    ).resolves.toBe(remaining);
    expect(cache.ttl).toHaveBeenCalledWith("auth:ip-block:203.0.113.1");
  });

  it("lists live blocks soonest first, skipping one that lapsed mid-read", async () => {
    const cache = createCache();
    cache.scanKeys.mockResolvedValue([
      "auth:ip-block:203.0.113.2",
      "auth:ip-block:203.0.113.3",
      "auth:ip-block:2001:db8::1",
    ]);
    cache.mget.mockResolvedValue([
      "2026-10-26T13:30:00.000Z",
      null,
      "2026-10-26T13:00:00.000Z",
    ]);

    await expect(new AuthIpBlockStore(cache).list()).resolves.toEqual([
      { ipAddress: "2001:db8::1", expiresAt: "2026-10-26T13:00:00.000Z" },
      { ipAddress: "203.0.113.2", expiresAt: "2026-10-26T13:30:00.000Z" },
    ]);
    expect(cache.scanKeys).toHaveBeenCalledWith("auth:ip-block:*");
  });

  it("lists nothing without reading values when no block exists", async () => {
    const cache = createCache();

    await expect(new AuthIpBlockStore(cache).list()).resolves.toEqual([]);
    expect(cache.mget).not.toHaveBeenCalled();
  });

  it("clears a block and says whether there was one", async () => {
    const cache = createCache();
    cache.delete.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const store = new AuthIpBlockStore(cache);

    await expect(store.clear("203.0.113.1")).resolves.toBe(true);
    await expect(store.clear("203.0.113.1")).resolves.toBe(false);
    expect(cache.delete).toHaveBeenCalledWith("auth:ip-block:203.0.113.1");
  });
});
