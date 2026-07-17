import { CacheService } from "@/features/cache/cache.service";

function createRedisClientMock() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    incrBy: jest.fn(),
    decrBy: jest.fn(),
    mGet: jest.fn(),
    mSet: jest.fn(),
    scan: jest.fn(),
    eval: jest.fn(),
  };
}

describe("CacheService", () => {
  it("reads and writes plain string values", async () => {
    const client = createRedisClientMock();
    client.get.mockResolvedValue("value-1");
    client.set.mockResolvedValue("OK");
    const service = new CacheService(client as any);

    await expect(service.get("key-1")).resolves.toBe("value-1");

    await service.set("key-2", "value-2");
    await service.set("key-3", "value-3", 60);

    expect(client.set).toHaveBeenNthCalledWith(1, "key-2", "value-2");
    expect(client.set).toHaveBeenNthCalledWith(2, "key-3", "value-3", {
      EX: 60,
    });
  });

  it("parses cached JSON values and deletes malformed payloads", async () => {
    const client = createRedisClientMock();
    client.get
      .mockResolvedValueOnce(JSON.stringify({ ok: true }))
      .mockResolvedValueOnce("{bad json");
    client.del.mockResolvedValue(1);
    const service = new CacheService(client as any);

    await expect(service.getJson("good")).resolves.toEqual({ ok: true });
    await expect(service.getJson("bad")).resolves.toBeNull();
    expect(client.del).toHaveBeenCalledWith("bad");
  });

  it("supports JSON writes, NX writes, and lazy population helpers", async () => {
    const client = createRedisClientMock();
    client.set
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("OK");
    client.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ cached: true }));
    const service = new CacheService(client as any);
    const factory = jest.fn(async () => ({ generated: true }));

    await service.setJson("json-key", { ok: true }, 30);
    await expect(
      service.setIfNotExists("lock-key", "00000000-0000-0000-0000-000000000001", 15),
    ).resolves.toBe(true);
    await expect(service.setIfNotExists("lock-key", "00000000-0000-0000-0000-000000000002")).resolves.toBe(
      false,
    );
    await expect(
      service.getOrSetJson("fresh-key", factory, 45),
    ).resolves.toEqual({ generated: true });
    await expect(
      service.getOrSetJson("cached-key", factory, 45),
    ).resolves.toEqual({ cached: true });

    expect(client.set).toHaveBeenNthCalledWith(
      1,
      "json-key",
      JSON.stringify({ ok: true }),
      {
        EX: 30,
      },
    );
    expect(client.set).toHaveBeenNthCalledWith(2, "lock-key", "00000000-0000-0000-0000-000000000001", {
      NX: true,
      EX: 15,
    });
    expect(client.set).toHaveBeenNthCalledWith(3, "lock-key", "00000000-0000-0000-0000-000000000002", {
      NX: true,
    });
    expect(client.set).toHaveBeenNthCalledWith(
      4,
      "fresh-key",
      JSON.stringify({ generated: true }),
      {
        EX: 45,
      },
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("supports deletion, existence, expiry, ttl, and counter helpers", async () => {
    const client = createRedisClientMock();
    client.del.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    client.exists.mockResolvedValueOnce(1);
    client.expire.mockResolvedValueOnce(0);
    client.ttl.mockResolvedValue(55);
    client.incrBy.mockResolvedValue(7);
    client.decrBy.mockResolvedValue(2);
    const service = new CacheService(client as any);

    await expect(service.delete("key-1")).resolves.toBe(true);
    await expect(service.deleteMany([])).resolves.toBe(0);
    await expect(service.deleteMany(["a", "b"])).resolves.toBe(2);
    await expect(service.exists("key-1")).resolves.toBe(true);
    await expect(service.expire("key-1", 10)).resolves.toBe(false);
    await expect(service.ttl("key-1")).resolves.toBe(55);
    await expect(service.increment("counter", 3)).resolves.toBe(7);
    await expect(service.decrement("counter", 5)).resolves.toBe(2);

    expect(client.del).toHaveBeenNthCalledWith(2, ["a", "b"]);
    expect(client.exists).toHaveBeenCalledWith("key-1");
    expect(client.expire).toHaveBeenCalledWith("key-1", 10);
    expect(client.incrBy).toHaveBeenCalledWith("counter", 3);
    expect(client.decrBy).toHaveBeenCalledWith("counter", 5);
  });

  it("supports multi-key reads and writes", async () => {
    const client = createRedisClientMock();
    client.mGet.mockResolvedValue(["one", null]);
    client.mSet.mockResolvedValue("OK");
    const service = new CacheService(client as any);

    await expect(service.mget([])).resolves.toEqual([]);
    await expect(service.mget(["a", "b"])).resolves.toEqual(["one", null]);

    await service.mset({});
    await service.mset({
      a: "1",
      b: "2",
    });

    expect(client.mGet).toHaveBeenCalledWith(["a", "b"]);
    expect(client.mSet).toHaveBeenCalledTimes(1);
    expect(client.mSet).toHaveBeenCalledWith({
      a: "1",
      b: "2",
    });
  });

  it("scans keys across cursors and deletes keys by pattern", async () => {
    const client = createRedisClientMock();
    client.scan
      .mockResolvedValueOnce({
        cursor: "1",
        keys: ["postings:1"],
      })
      .mockResolvedValueOnce({
        cursor: "0",
        keys: ["postings:2"],
      })
      .mockResolvedValueOnce({
        cursor: "0",
        keys: [],
      });
    client.del.mockResolvedValue(2);
    const service = new CacheService(client as any);

    await expect(service.scanKeys("postings:*", 50)).resolves.toEqual([
      "postings:1",
      "postings:2",
    ]);
    await expect(service.deleteByPattern("postings:*")).resolves.toBe(0);

    client.scan.mockResolvedValueOnce({
      cursor: "0",
      keys: ["users:1", "users:2"],
    });

    await expect(service.deleteByPattern("users:*")).resolves.toBe(2);

    expect(client.scan).toHaveBeenNthCalledWith(1, "0", {
      MATCH: "postings:*",
      COUNT: 50,
    });
    expect(client.del).toHaveBeenCalledWith(["users:1", "users:2"]);
  });

  it("passes eval through and manages Redis-backed locks", async () => {
    const client = createRedisClientMock();
    client.eval
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    client.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    const service = new CacheService(client as any);

    await expect(service.eval("return 1", ["a"], ["b"])).resolves.toEqual({
      ok: true,
    });

    const lock = await service.acquireLock("jobs", 5_000, "00000000-0000-0000-0000-000000000001");
    const missingLock = await service.acquireLock("jobs", 5_000, "00000000-0000-0000-0000-000000000002");

    expect(lock).not.toBeNull();
    expect(missingLock).toBeNull();
    await expect(lock?.release()).resolves.toBe(true);
    await expect(lock?.extend(6_000)).resolves.toBe(true);
    await expect(service.releaseLock("lock:jobs", "00000000-0000-0000-0000-000000000001")).resolves.toBe(
      false,
    );
    await expect(
      service.extendLock("lock:jobs", "00000000-0000-0000-0000-000000000001", 7_000),
    ).resolves.toBe(false);

    expect(client.set).toHaveBeenNthCalledWith(1, "lock:jobs", "00000000-0000-0000-0000-000000000001", {
      NX: true,
      PX: 5000,
    });
    expect(client.eval).toHaveBeenNthCalledWith(2, expect.any(String), {
      keys: ["lock:jobs"],
      arguments: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(client.eval).toHaveBeenNthCalledWith(3, expect.any(String), {
      keys: ["lock:jobs"],
      arguments: ["00000000-0000-0000-0000-000000000001", "6000"],
    });
  });

  it("runs callbacks under a lock and releases the lock on success and failure", async () => {
    const service = new CacheService({} as any);
    const release = jest.fn(async () => true);
    const acquireLock = jest
      .spyOn(service, "acquireLock")
      .mockResolvedValueOnce({
        key: "lock:sync",
        token: "00000000-0000-0000-0000-000000000001",
        release,
        extend: jest.fn(async () => true),
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        key: "lock:sync",
        token: "00000000-0000-0000-0000-000000000002",
        release,
        extend: jest.fn(async () => true),
      });

    await expect(
      service.withLock("sync", 5_000, async () => "done"),
    ).resolves.toBe("done");
    await expect(
      service.withLock("sync", 5_000, async () => "never"),
    ).rejects.toThrow("Could not acquire Redis lock for key: sync");
    await expect(
      service.withLock("sync", 5_000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(acquireLock).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
