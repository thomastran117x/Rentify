import { normalizeUsernameForBloom } from "@/features/auth/identity-bloom/bloom-hash";
import {
  emailBloomSubject,
  usernameBloomSubject,
} from "@/features/auth/identity-bloom/identity-bloom-subject";
import { deriveBloomParameters } from "@/features/auth/identity-bloom/bloom-parameters";
import { LocalBloomFilter } from "@/features/auth/identity-bloom/local-bloom-filter";
import {
  buildIdentityBloomKeys,
  type IdentityBloomEvent,
  type IdentityBloomMeta,
} from "@/features/auth/identity-bloom/identity-bloom-keys";
import {
  IdentityBloomService,
  type IdentityBloomConfig,
} from "@/features/auth/identity-bloom/identity-bloom.service";

const baseConfig: IdentityBloomConfig = {
  enabled: true,
  capacity: 1_000,
  falsePositiveRate: 0.01,
  reloadIntervalMs: 60_000,
  maxStalenessMs: 300_000,
};

const parameters = deriveBloomParameters(
  baseConfig.capacity,
  baseConfig.falsePositiveRate,
);
const keys = buildIdentityBloomKeys(
  usernameBloomSubject.cachePrefix,
  parameters.fingerprint,
);

function buildBitmap(...usernames: string[]): Buffer {
  const filter = new LocalBloomFilter(parameters, normalizeUsernameForBloom);

  for (const username of usernames) {
    filter.add(username);
  }

  return filter.toBuffer();
}

function createMeta(
  overrides: Partial<IdentityBloomMeta> = {},
): IdentityBloomMeta {
  return {
    generation: 1,
    builtAt: "2026-08-17T00:00:00.000Z",
    valueCount: 2,
    estimatedFalsePositiveRate: 0.01,
    ...overrides,
  };
}

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

function createStore(initial?: {
  meta?: IdentityBloomMeta | null;
  bitmap?: Buffer | null;
  shadowPointer?: string | null;
  subscribeError?: Error;
}) {
  const calls: string[] = [];
  const state = {
    meta: initial?.meta ?? null,
    bitmap: initial?.bitmap ?? null,
    shadowPointer: initial?.shadowPointer ?? null,
    published: [] as IdentityBloomEvent[],
    replay: [] as string[],
    setBits: [] as Array<{ key: string; indices: number[] }>,
    emit: null as ((event: IdentityBloomEvent) => void) | null,
    onError: null as ((error: unknown) => void) | null,
    closed: false,
    calls,
  };

  const store = {
    readMeta: jest.fn(async () => state.meta),
    readBitmap: jest.fn(async () => state.bitmap),
    setBits: jest.fn(async (key: string, indices: number[]) => {
      calls.push("setBits");
      state.setBits.push({ key, indices });
    }),
    publish: jest.fn(async (_channel: string, event: IdentityBloomEvent) => {
      calls.push("publish");
      state.published.push(event);
    }),
    readKey: jest.fn(async () => state.shadowPointer),
    pushReplayEntries: jest.fn(async (_key: string, usernames: string[]) => {
      calls.push("pushReplayEntries");
      state.replay.push(...usernames);
    }),
    subscribe: jest.fn(
      async (
        _channel: string,
        onEvent: (event: IdentityBloomEvent) => void,
        onError: (error: unknown) => void,
      ) => {
        if (initial?.subscribeError) {
          throw initial.subscribeError;
        }

        state.emit = onEvent;
        state.onError = onError;

        return {
          close: jest.fn(async () => {
            state.closed = true;
          }),
        };
      },
    ),
  };

  return { store, state };
}

function createService(
  options: {
    subject?: typeof usernameBloomSubject;
    config?: Partial<IdentityBloomConfig>;
    store?: ReturnType<typeof createStore>;
    now?: () => number;
  } = {},
) {
  const harness = options.store ?? createStore();
  const logger = createLogger();
  const service = new IdentityBloomService(
    options.subject ?? usernameBloomSubject,
    harness.store as never,
    { ...baseConfig, ...options.config },
    logger as never,
    options.now ?? (() => 1_000),
  );

  return { service, logger, ...harness };
}

describe("IdentityBloomService", () => {
  describe("readiness", () => {
    it("reports unknown before it has been initialized", () => {
      const { service } = createService();

      expect(service.check("casey-doe")).toBe("unknown");
      expect(service.isReady()).toBe(false);
    });

    it("reports unknown when the filter is disabled", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({
        config: { enabled: false },
        store,
      });

      await service.initialize();

      expect(service.check("casey-doe")).toBe("unknown");
      expect(store.store.subscribe).not.toHaveBeenCalled();
    });

    it("stays unready when no rebuild has published metadata yet", async () => {
      // An empty bit array answers "absent" for every name. Serving from one
      // would report every username in the system as available.
      const store = createStore({ meta: null, bitmap: null });
      const { service } = createService({ store });

      await service.initialize();

      expect(service.isReady()).toBe(false);
      expect(service.check("casey-doe")).toBe("unknown");

      await service.dispose();
    });

    it("stays unready when metadata exists but the bitmap is gone", async () => {
      const store = createStore({ meta: createMeta(), bitmap: null });
      const { service } = createService({ store });

      await service.initialize();

      expect(service.isReady()).toBe(false);
      expect(service.check("casey-doe")).toBe("unknown");

      await service.dispose();
    });

    it("serves verdicts once a bitmap and metadata are present", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();

      expect(service.isReady()).toBe(true);
      expect(service.check("casey-doe")).toBe("possibly-present");
      expect(service.check("nobody-has-this-name")).toBe("definitely-absent");

      await service.dispose();
    });

    it("matches the stored casing rules", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();

      expect(service.check("  Casey-DOE ")).toBe("possibly-present");

      await service.dispose();
    });

    it("reports unknown for a blank username", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();

      expect(service.check("   ")).toBe("unknown");

      await service.dispose();
    });

    it("stops answering once its copy is older than the staleness bound", async () => {
      // A wedged subscriber must degrade to the database rather than keep
      // answering from a bit array nobody is refreshing.
      let clock = 1_000;
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store, now: () => clock });

      await service.initialize();
      expect(service.check("nobody")).toBe("definitely-absent");

      clock += baseConfig.maxStalenessMs + 1;

      expect(service.check("nobody")).toBe("unknown");

      await service.dispose();
    });

    it("initializes only once even when called repeatedly", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await Promise.all([
        service.initialize(),
        service.initialize(),
        service.initialize(),
      ]);

      expect(store.store.subscribe).toHaveBeenCalledTimes(1);

      await service.dispose();
    });

    it("still loads when the subscription cannot be established", async () => {
      // Losing propagation costs latency, which the reload timer bounds.
      // Refusing to start would cost every request a database query.
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
        subscribeError: new Error("redis is unhappy"),
      });
      const { service, logger } = createService({ store });

      await service.initialize();

      expect(service.isReady()).toBe(true);
      expect(logger.warn).toHaveBeenCalled();

      await service.dispose();
    });

    it("stays unready when the stored bitmap does not match its parameters", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: Buffer.alloc(parameters.byteLength + 10),
      });
      const { service, logger } = createService({ store });

      await service.initialize();

      expect(service.isReady()).toBe(false);
      expect(service.check("casey-doe")).toBe("unknown");
      expect(logger.error).toHaveBeenCalled();

      await service.dispose();
    });
  });

  describe("add", () => {
    it("records the name locally, in Redis, and to subscribers", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap(),
      });
      const { service } = createService({ store });

      await service.initialize();
      expect(service.check("river-stone")).toBe("definitely-absent");

      await service.add("River-Stone");

      expect(service.check("river-stone")).toBe("possibly-present");
      expect(store.state.setBits[0]?.key).toBe(keys.bits);
      expect(store.state.setBits[0]?.indices).toHaveLength(
        parameters.hashCount,
      );
      expect(store.state.published).toEqual([
        { type: "add", values: ["river-stone"] },
      ]);

      await service.dispose();
    });

    it("accepts a batch of names", async () => {
      const store = createStore({ meta: createMeta(), bitmap: buildBitmap() });
      const { service } = createService({ store });

      await service.initialize();
      await service.add(["one-name", "two-name"]);

      expect(service.check("one-name")).toBe("possibly-present");
      expect(service.check("two-name")).toBe("possibly-present");
      expect(store.state.setBits[0]?.indices).toHaveLength(
        parameters.hashCount * 2,
      );

      await service.dispose();
    });

    it("ignores blank names", async () => {
      const store = createStore({ meta: createMeta(), bitmap: buildBitmap() });
      const { service } = createService({ store });

      await service.initialize();
      await service.add(["   ", ""]);

      expect(store.store.setBits).not.toHaveBeenCalled();

      await service.dispose();
    });

    it("does nothing when the filter is disabled", async () => {
      const store = createStore();
      const { service } = createService({ config: { enabled: false }, store });

      await service.add("river-stone");

      expect(store.store.setBits).not.toHaveBeenCalled();
      expect(store.store.publish).not.toHaveBeenCalled();
    });

    it("never throws when Redis rejects the write", async () => {
      // A signup must not fail because a cache write did. The local bit is
      // already set and the next rebuild recovers the rest.
      const store = createStore({ meta: createMeta(), bitmap: buildBitmap() });
      store.store.setBits.mockRejectedValueOnce(new Error("redis is down"));
      const { service, logger } = createService({ store });

      await service.initialize();
      await expect(service.add("river-stone")).resolves.toBeUndefined();

      expect(service.check("river-stone")).toBe("possibly-present");
      expect(logger.warn).toHaveBeenCalled();

      await service.dispose();
    });

    it("records the name for replay while a rebuild is in flight", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap(),
        shadowPointer: "2",
      });
      const { service } = createService({ store });

      await service.initialize();
      await service.add("river-stone");

      expect(store.store.pushReplayEntries).toHaveBeenCalledWith(
        keys.replayList(2),
        ["river-stone"],
      );

      await service.dispose();
    });

    it("pushes to the replay list before setting the live bit", async () => {
      // The ordering is what makes the rebuild hand-off airtight: a push that
      // arrives too late to be replayed guarantees its live write lands after
      // the swap, so the bit survives either way.
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap(),
        shadowPointer: "2",
      });
      const { service } = createService({ store });

      await service.initialize();
      store.state.calls.length = 0;
      await service.add("river-stone");

      expect(store.state.calls).toEqual([
        "pushReplayEntries",
        "setBits",
        "publish",
      ]);

      await service.dispose();
    });

    it("skips replay bookkeeping when no rebuild is running", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap(),
        shadowPointer: null,
      });
      const { service } = createService({ store });

      await service.initialize();
      await service.add("river-stone");

      expect(store.store.pushReplayEntries).not.toHaveBeenCalled();

      await service.dispose();
    });

    it("ignores a shadow pointer that is not a generation number", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap(),
        shadowPointer: "not-a-number",
      });
      const { service } = createService({ store });

      await service.initialize();
      await service.add("river-stone");

      expect(store.store.pushReplayEntries).not.toHaveBeenCalled();
      expect(store.store.setBits).toHaveBeenCalled();

      await service.dispose();
    });
  });

  describe("propagation", () => {
    it("adopts names announced by another instance", async () => {
      const store = createStore({ meta: createMeta(), bitmap: buildBitmap() });
      const { service } = createService({ store });

      await service.initialize();
      expect(service.check("river-stone")).toBe("definitely-absent");

      store.state.emit?.({ type: "add", values: ["River-Stone", "  "] });

      expect(service.check("river-stone")).toBe("possibly-present");

      await service.dispose();
    });

    it("reloads when a rebuild announces a new generation", async () => {
      const store = createStore({
        meta: createMeta({ generation: 1 }),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();
      expect(service.check("river-stone")).toBe("definitely-absent");

      store.state.meta = createMeta({ generation: 2 });
      store.state.bitmap = buildBitmap("river-stone");
      store.state.emit?.({ type: "rebuilt", generation: 2 });
      await Promise.resolve();
      await Promise.resolve();

      expect(service.check("river-stone")).toBe("possibly-present");
      // The swap sheds bits the old bitmap carried.
      expect(service.check("casey-doe")).toBe("definitely-absent");

      await service.dispose();
    });

    it("ignores a rebuild announcement for the generation it already has", async () => {
      const store = createStore({
        meta: createMeta({ generation: 1 }),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();
      store.store.readMeta.mockClear();

      store.state.emit?.({ type: "rebuilt", generation: 1 });
      await Promise.resolve();

      expect(store.store.readMeta).not.toHaveBeenCalled();

      await service.dispose();
    });

    it("surfaces subscription errors without tearing the filter down", async () => {
      const store = createStore({ meta: createMeta(), bitmap: buildBitmap() });
      const { service, logger } = createService({ store });

      await service.initialize();
      store.state.onError?.(new Error("connection reset"));

      expect(logger.warn).toHaveBeenCalled();
      expect(service.isReady()).toBe(true);

      await service.dispose();
    });
  });

  describe("reload", () => {
    it("merges within a generation so local writes are not erased", async () => {
      // The bitmap read can start before a local add reaches Redis. Replacing
      // would drop that bit and hand back a false negative.
      const store = createStore({
        meta: createMeta({ generation: 1 }),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();
      await service.add("river-stone");

      store.state.bitmap = buildBitmap("casey-doe");
      await service.reload();

      expect(service.check("river-stone")).toBe("possibly-present");
      expect(service.check("casey-doe")).toBe("possibly-present");

      await service.dispose();
    });

    it("keeps an add whose write is still in flight across a generation swap", async () => {
      // The dangerous interleaving: the bitmap is read before the add reaches
      // Redis, so adopting it would erase a name that really was claimed.
      const store = createStore({
        meta: createMeta({ generation: 1 }),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();

      let releaseWrite: () => void = () => undefined;
      store.store.setBits.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            releaseWrite = () => resolve();
          }),
      );

      const pendingAdd = service.add("river-stone");
      await Promise.resolve();

      store.state.meta = createMeta({ generation: 2 });
      store.state.bitmap = buildBitmap("casey-doe");
      await service.reload();

      expect(service.check("river-stone")).toBe("possibly-present");

      releaseWrite();
      await pendingAdd;

      await service.dispose();
    });

    it("lets a rebuild shed a name once its write has settled", async () => {
      // The counterpart to the case above. Holding on to every recent add would
      // make the periodic rebuild unable to drop anything, which is the only
      // mechanism that clears bits a bloom filter cannot delete.
      const store = createStore({
        meta: createMeta({ generation: 1 }),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();
      await service.add("river-stone");

      store.state.meta = createMeta({ generation: 2 });
      store.state.bitmap = buildBitmap("casey-doe");
      await service.reload();

      expect(service.check("river-stone")).toBe("definitely-absent");

      await service.dispose();
    });

    it("drops back to unready when the bitmap disappears", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();
      expect(service.isReady()).toBe(true);

      store.state.bitmap = null;
      await service.reload();

      expect(service.isReady()).toBe(false);
      expect(service.check("anything")).toBe("unknown");

      await service.dispose();
    });

    it("reads metadata before the bitmap", async () => {
      // Reading it the other way round lets a rebuild landing mid-reload pair a
      // new generation number with the old bitmap, which would leave this
      // instance convinced it was current.
      const order: string[] = [];
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      store.store.readMeta.mockImplementation(async () => {
        order.push("meta");
        return store.state.meta;
      });
      store.store.readBitmap.mockImplementation(async () => {
        order.push("bitmap");
        return store.state.bitmap;
      });
      const { service } = createService({ store });

      await service.initialize();

      expect(order).toEqual(["meta", "bitmap"]);

      await service.dispose();
    });

    it("refreshes the staleness clock on every successful reload", async () => {
      let clock = 1_000;
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store, now: () => clock });

      await service.initialize();
      clock += baseConfig.maxStalenessMs + 1;
      expect(service.check("nobody")).toBe("unknown");

      await service.reload();

      expect(service.check("nobody")).toBe("definitely-absent");

      await service.dispose();
    });
  });

  describe("scheduled reload", () => {
    it("refreshes on the configured interval", async () => {
      jest.useFakeTimers();

      try {
        const store = createStore({
          meta: createMeta({ generation: 1 }),
          bitmap: buildBitmap("casey-doe"),
        });
        const { service } = createService({ store });

        await service.initialize();
        store.state.meta = createMeta({ generation: 2 });
        store.state.bitmap = buildBitmap("river-stone");

        jest.advanceTimersByTime(baseConfig.reloadIntervalMs);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(service.check("river-stone")).toBe("possibly-present");

        await service.dispose();
      } finally {
        jest.useRealTimers();
      }
    });

    it("logs and carries on when a scheduled reload fails", async () => {
      jest.useFakeTimers();

      try {
        const store = createStore({
          meta: createMeta(),
          bitmap: buildBitmap("casey-doe"),
        });
        const { service, logger } = createService({ store });

        await service.initialize();
        store.store.readMeta.mockRejectedValueOnce(new Error("redis is down"));

        jest.advanceTimersByTime(baseConfig.reloadIntervalMs);
        await Promise.resolve();
        await Promise.resolve();

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("scheduled username bloom reload"),
          { subject: "username" },
          expect.any(Error),
        );
        // The previous copy is still usable.
        expect(service.isReady()).toBe(true);

        await service.dispose();
      } finally {
        jest.useRealTimers();
      }
    });

    it("logs when the reload triggered by a rebuild announcement fails", async () => {
      const store = createStore({
        meta: createMeta({ generation: 1 }),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service, logger } = createService({ store });

      await service.initialize();
      store.store.readMeta.mockRejectedValueOnce(new Error("redis is down"));

      store.state.emit?.({ type: "rebuilt", generation: 2 });
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("after a rebuild"),
        { subject: "username", generation: 2 },
        expect.any(Error),
      );

      await service.dispose();
    });

    it("stops scheduling once disposed", async () => {
      jest.useFakeTimers();

      try {
        const store = createStore({
          meta: createMeta(),
          bitmap: buildBitmap("casey-doe"),
        });
        const { service } = createService({ store });

        await service.initialize();
        await service.dispose();
        store.store.readMeta.mockClear();

        jest.advanceTimersByTime(baseConfig.reloadIntervalMs * 3);
        await Promise.resolve();

        expect(store.store.readMeta).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("parameters", () => {
    it("exposes the sizing it derived from configuration", () => {
      const { service } = createService();

      expect(service.getParameters()).toEqual(parameters);
    });
  });

  describe("dispose", () => {
    it("closes the subscription and is safe to call twice", async () => {
      const store = createStore({
        meta: createMeta(),
        bitmap: buildBitmap("casey-doe"),
      });
      const { service } = createService({ store });

      await service.initialize();
      await service.dispose();

      expect(store.state.closed).toBe(true);

      await expect(service.dispose()).resolves.toBeUndefined();
    });
  });
});

describe("IdentityBloomService for the email subject", () => {
  it("folds case the way the unique index does", async () => {
    // `users_email_key` sits on a case-insensitive column, so an address added
    // as `Casey@Example.com` has to be found when checked as `casey@...` — the
    // false negative this filter must never produce.
    const store = createStore({ meta: createMeta(), bitmap: Buffer.alloc(0) });
    const { service } = createService({ subject: emailBloomSubject, store });

    await service.initialize();
    await service.add("Casey@Example.COM");

    expect(service.check("casey@example.com")).toBe("possibly-present");
    expect(service.check("  CASEY@EXAMPLE.com ")).toBe("possibly-present");
  });

  it("keeps plus tags and dots significant", async () => {
    // Those addresses occupy distinct rows, so collapsing them would make the
    // filter claim a value is present when the index says otherwise.
    const store = createStore({ meta: createMeta(), bitmap: Buffer.alloc(0) });
    const { service } = createService({ subject: emailBloomSubject, store });

    await service.initialize();
    await service.add("casey@example.com");

    expect(service.check("casey+rent@example.com")).toBe("definitely-absent");
  });

  it("uses its own Redis keyspace", async () => {
    const store = createStore({ meta: createMeta(), bitmap: Buffer.alloc(0) });
    const { service } = createService({ subject: emailBloomSubject, store });

    await service.initialize();
    await service.add("casey@example.com");

    for (const { key } of store.state.setBits) {
      expect(key.startsWith("auth:email-bloom:")).toBe(true);
    }
  });
});
