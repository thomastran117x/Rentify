import { deriveBloomParameters } from "@/features/auth/username-bloom/bloom-parameters";
import { LocalBloomFilter } from "@/features/auth/username-bloom/local-bloom-filter";
import {
  buildUsernameBloomKeys,
  type UsernameBloomEvent,
  type UsernameBloomMeta,
} from "@/features/auth/username-bloom/username-bloom-keys";
import {
  rebuildUsernameBloom,
  type UsernameBloomRebuildConfig,
} from "@/features/auth/username-bloom/username-bloom-rebuild";

const config: UsernameBloomRebuildConfig = {
  capacity: 1_000,
  falsePositiveRate: 0.01,
  rebuildIntervalMs: 3_600_000,
  batchSize: 2,
  lockTtlMs: 60_000,
};

const parameters = deriveBloomParameters(
  config.capacity,
  config.falsePositiveRate,
);
const keys = buildUsernameBloomKeys(parameters.fingerprint);
const NOW = Date.parse("2026-08-17T12:00:00.000Z");

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
    child: jest.fn(),
  };
}

function createHarness(options?: {
  meta?: UsernameBloomMeta | null;
  usernames?: string[];
  reservations?: string[];
  replay?: string[];
  lockGranted?: boolean;
}) {
  const calls: string[] = [];
  const state = {
    meta: options?.meta ?? null,
    bitmaps: new Map<string, Buffer>(),
    keyValues: new Map<string, string>(),
    published: [] as UsernameBloomEvent[],
    setBits: [] as Array<{ key: string; indices: number[] }>,
    deleted: [] as string[][],
    renames: [] as Array<{ from: string; to: string }>,
    extendCount: 0,
    released: false,
    calls,
  };

  const store = {
    readMeta: jest.fn(async () => state.meta),
    writeMeta: jest.fn(async (_key: string, meta: UsernameBloomMeta) => {
      calls.push("writeMeta");
      state.meta = meta;
    }),
    readBitmap: jest.fn(async (key: string) => state.bitmaps.get(key) ?? null),
    writeBitmap: jest.fn(async (key: string, bitmap: Buffer) => {
      calls.push(`writeBitmap:${key}`);
      state.bitmaps.set(key, bitmap);
    }),
    setBits: jest.fn(async (key: string, indices: number[]) => {
      calls.push(`setBits:${key}`);
      state.setBits.push({ key, indices });
    }),
    publish: jest.fn(async (_channel: string, event: UsernameBloomEvent) => {
      calls.push("publish");
      state.published.push(event);
    }),
    readKey: jest.fn(async (key: string) => state.keyValues.get(key) ?? null),
    writeKey: jest.fn(async (key: string, value: string) => {
      calls.push(`writeKey:${key}`);
      state.keyValues.set(key, value);
    }),
    readReplayEntries: jest.fn(async () => {
      calls.push("readReplay");
      return options?.replay ?? [];
    }),
    pushReplayEntries: jest.fn(async () => undefined),
    rename: jest.fn(async (from: string, to: string) => {
      calls.push("rename");
      state.renames.push({ from, to });
      const bitmap = state.bitmaps.get(from);

      if (bitmap) {
        state.bitmaps.set(to, bitmap);
        state.bitmaps.delete(from);
      }
    }),
    delete: jest.fn(async (deletedKeys: string[]) => {
      calls.push(`delete:${deletedKeys.join(",")}`);
      state.deleted.push(deletedKeys);

      for (const key of deletedKeys) {
        state.keyValues.delete(key);
        state.bitmaps.delete(key);
      }
    }),
    exists: jest.fn(async () => false),
  };

  const usernames = options?.usernames ?? ["casey-doe", "river-stone"];
  const repository = {
    listUsernamesAfter: jest.fn(
      async (cursorId: string | null, take: number) => {
        const startIndex = cursorId ? usernames.indexOf(cursorId) + 1 : 0;
        const page = usernames.slice(startIndex, startIndex + take);

        return {
          usernames: page,
          nextCursorId: page.length < take ? null : (page.at(-1) ?? null),
        };
      },
    ),
  };

  const cacheService = {
    acquireLock: jest.fn(async () =>
      options?.lockGranted === false
        ? null
        : {
            key: keys.rebuildLock,
            token: "token",
            release: jest.fn(async () => {
              state.released = true;
              return true;
            }),
            extend: jest.fn(async () => {
              state.extendCount += 1;
              return true;
            }),
          },
    ),
    scanKeys: jest.fn(async () =>
      (options?.reservations ?? []).map(
        (name) => `auth:pending-signup-username:${name}`,
      ),
    ),
  };

  const logger = createLogger();

  return {
    state,
    store,
    repository,
    cacheService,
    logger,
    run: () =>
      rebuildUsernameBloom({
        store: store as never,
        repository: repository as never,
        cacheService: cacheService as never,
        config,
        logger: logger as never,
        now: () => NOW,
      }),
  };
}

describe("rebuildUsernameBloom", () => {
  it("builds the bitmap from every stored username", async () => {
    const harness = createHarness({
      usernames: ["casey-doe", "river-stone", "sky-walker"],
    });

    const result = await harness.run();

    expect(result).toMatchObject({
      status: "rebuilt",
      generation: 1,
      usernameCount: 3,
    });

    const filter = new LocalBloomFilter(parameters);
    filter.replaceFrom(harness.state.bitmaps.get(keys.bits)!);

    expect(filter.has("casey-doe")).toBe(true);
    expect(filter.has("river-stone")).toBe(true);
    expect(filter.has("sky-walker")).toBe(true);
    expect(filter.has("never-registered")).toBe(false);
  });

  it("pages through the table rather than loading it at once", async () => {
    const harness = createHarness({
      usernames: ["a-one", "b-two", "c-three", "d-four", "e-five"],
    });

    await harness.run();

    // batchSize is 2, so five rows take three pages.
    expect(harness.repository.listUsernamesAfter).toHaveBeenCalledTimes(3);
    expect(harness.repository.listUsernamesAfter).toHaveBeenNthCalledWith(
      1,
      null,
      2,
    );
    expect(harness.repository.listUsernamesAfter).toHaveBeenNthCalledWith(
      2,
      "b-two",
      2,
    );
  });

  it("extends the lock while walking a long table", async () => {
    const harness = createHarness({
      usernames: ["a-one", "b-two", "c-three", "d-four", "e-five"],
    });

    await harness.run();

    expect(harness.state.extendCount).toBeGreaterThan(0);
  });

  it("includes unverified signup reservations", async () => {
    // A reservation makes a name unavailable, and a filter miss skips the
    // reservation lookup too. Omitting them would report a reserved name free.
    const harness = createHarness({
      usernames: ["casey-doe"],
      reservations: ["pending-person"],
    });

    const result = await harness.run();
    const filter = new LocalBloomFilter(parameters);
    filter.replaceFrom(harness.state.bitmaps.get(keys.bits)!);

    expect(filter.has("pending-person")).toBe(true);
    expect(result.usernameCount).toBe(2);
  });

  it("writes the bitmap once and swaps it in atomically", async () => {
    const harness = createHarness();

    await harness.run();

    expect(harness.store.writeBitmap).toHaveBeenCalledTimes(1);
    expect(harness.state.renames).toEqual([
      { from: keys.shadowBits(1), to: keys.bits },
    ]);
  });

  it("registers a shadow pointer before reading the table", async () => {
    const harness = createHarness();

    await harness.run();

    const pointerIndex = harness.state.calls.indexOf(
      `writeKey:${keys.shadowPointer}`,
    );
    const writeIndex = harness.state.calls.indexOf(
      `writeBitmap:${keys.shadowBits(1)}`,
    );

    expect(pointerIndex).toBeGreaterThanOrEqual(0);
    expect(pointerIndex).toBeLessThan(writeIndex);
  });

  it("clears the shadow pointer before the final replay read", async () => {
    // Once the pointer is gone no writer can append, so a single read after it
    // is guaranteed to see every entry that could still matter.
    const harness = createHarness({ replay: ["late-arrival"] });

    await harness.run();

    const pointerDeleteIndex = harness.state.calls.indexOf(
      `delete:${keys.shadowPointer}`,
    );
    const replayIndex = harness.state.calls.lastIndexOf("readReplay");

    expect(pointerDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(pointerDeleteIndex).toBeLessThan(replayIndex);
  });

  it("replays names claimed while the rebuild was running", async () => {
    const harness = createHarness({ replay: ["late-arrival"] });

    await harness.run();

    const scratch = new LocalBloomFilter(parameters);
    const expected = scratch.getIndices("late-arrival");

    expect(harness.state.setBits).toEqual([
      { key: keys.bits, indices: expected },
    ]);
  });

  it("replays into the live bitmap only after the swap", async () => {
    const harness = createHarness({ replay: ["late-arrival"] });

    await harness.run();

    expect(harness.state.calls.indexOf("rename")).toBeLessThan(
      harness.state.calls.indexOf(`setBits:${keys.bits}`),
    );
  });

  it("skips the replay write when nothing was claimed", async () => {
    const harness = createHarness({ replay: [] });

    await harness.run();

    expect(harness.store.setBits).not.toHaveBeenCalled();
  });

  it("announces the new generation after the metadata is written", async () => {
    // A reader told to reload must find metadata that already describes the
    // bitmap it is about to adopt.
    const harness = createHarness();

    await harness.run();

    expect(harness.state.calls.indexOf("writeMeta")).toBeLessThan(
      harness.state.calls.indexOf("publish"),
    );
    expect(harness.state.published).toEqual([
      { type: "rebuilt", generation: 1 },
    ]);
  });

  it("advances the generation from the previous build", async () => {
    const harness = createHarness({
      meta: {
        generation: 7,
        builtAt: new Date(NOW - config.rebuildIntervalMs - 1).toISOString(),
        usernameCount: 1,
        estimatedFalsePositiveRate: 0.01,
      },
    });

    const result = await harness.run();

    expect(result.generation).toBe(8);
    expect(harness.state.meta?.generation).toBe(8);
  });

  it("clears leftovers from an attempt that died mid-rebuild", async () => {
    const harness = createHarness();

    await harness.run();

    expect(harness.state.deleted[0]).toEqual([
      keys.shadowBits(1),
      keys.replayList(1),
    ]);
  });

  it("skips a rebuild that is still fresh", async () => {
    const harness = createHarness({
      meta: {
        generation: 3,
        builtAt: new Date(NOW - 1_000).toISOString(),
        usernameCount: 1,
        estimatedFalsePositiveRate: 0.01,
      },
    });

    const result = await harness.run();

    expect(result).toEqual({ status: "skipped-fresh", generation: 3 });
    expect(harness.cacheService.acquireLock).not.toHaveBeenCalled();
  });

  it("rebuilds once the previous build has aged out", async () => {
    const harness = createHarness({
      meta: {
        generation: 3,
        builtAt: new Date(NOW - config.rebuildIntervalMs - 1).toISOString(),
        usernameCount: 1,
        estimatedFalsePositiveRate: 0.01,
      },
    });

    await expect(harness.run()).resolves.toMatchObject({ status: "rebuilt" });
  });

  it("treats an unparseable build timestamp as stale", async () => {
    const harness = createHarness({
      meta: {
        generation: 3,
        builtAt: "not-a-date",
        usernameCount: 1,
        estimatedFalsePositiveRate: 0.01,
      },
    });

    await expect(harness.run()).resolves.toMatchObject({ status: "rebuilt" });
  });

  it("stands down when another instance holds the lock", async () => {
    const harness = createHarness({ lockGranted: false });

    const result = await harness.run();

    expect(result).toEqual({ status: "skipped-locked" });
    expect(harness.store.writeBitmap).not.toHaveBeenCalled();
  });

  it("re-checks freshness under the lock", async () => {
    // A sibling may have finished between the first check and the grant.
    const harness = createHarness();
    harness.store.readMeta.mockResolvedValueOnce(null).mockResolvedValueOnce({
      generation: 5,
      builtAt: new Date(NOW - 1_000).toISOString(),
      usernameCount: 1,
      estimatedFalsePositiveRate: 0.01,
    });

    const result = await harness.run();

    expect(result).toEqual({ status: "skipped-fresh", generation: 5 });
    expect(harness.store.writeBitmap).not.toHaveBeenCalled();
    expect(harness.state.released).toBe(true);
  });

  it("releases the lock even when the rebuild fails", async () => {
    const harness = createHarness();
    harness.repository.listUsernamesAfter.mockRejectedValueOnce(
      new Error("database is unhappy"),
    );

    await expect(harness.run()).rejects.toThrow("database is unhappy");
    expect(harness.state.released).toBe(true);
  });

  it("warns when the filter has outgrown its configured capacity", async () => {
    const harness = createHarness({
      usernames: Array.from({ length: 40 }, (_, index) => `user-${index}`),
    });
    // batchSize is 2, so a 40-name table pages fine; capacity is what matters.
    harness.repository.listUsernamesAfter.mockImplementation(
      async (cursorId: string | null) => {
        if (cursorId) {
          return { usernames: [], nextCursorId: null };
        }

        return {
          usernames: Array.from(
            { length: 4_000 },
            (_, index) => `crowd-${index}`,
          ),
          nextCursorId: null,
        };
      },
    );

    const result = await harness.run();

    expect(result.estimatedFalsePositiveRate).toBeGreaterThan(
      config.falsePositiveRate * 2,
    );
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("saturated"),
      expect.objectContaining({ capacity: config.capacity }),
    );
  });

  it("cleans up the replay list once it has been applied", async () => {
    const harness = createHarness({ replay: ["late-arrival"] });

    await harness.run();

    expect(harness.state.deleted).toContainEqual([keys.replayList(1)]);
  });
});
