import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { loggerFactory } from "@/configuration/logging";
import { environment } from "@/configuration/environment";
import { getPendingSignupUsernameKey } from "@/features/auth/pending-signup-username";
import { deriveBloomParameters } from "@/features/auth/username-bloom/bloom-parameters";
import { buildUsernameBloomKeys } from "@/features/auth/username-bloom/username-bloom-keys";
import { rebuildUsernameBloom } from "@/features/auth/username-bloom/username-bloom-rebuild";
import {
  UsernameBloomService,
  type UsernameBloomConfig,
} from "@/features/auth/username-bloom/username-bloom.service";
import { UsernameBloomStore } from "@/features/auth/username-bloom/username-bloom.store";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";

/**
 * These exercise the parts that only exist once Redis and MySQL are real: the
 * binary bitmap round trip, the cross-instance pub/sub hand-off, and a rebuild
 * reading the actual profiles table.
 */
describe("Username bloom filter persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  const config: UsernameBloomConfig = {
    enabled: true,
    capacity: 1_000,
    falsePositiveRate: 0.01,
    reloadIntervalMs: 60_000,
    maxStalenessMs: 300_000,
  };
  const parameters = deriveBloomParameters(
    config.capacity,
    config.falsePositiveRate,
  );
  const keys = buildUsernameBloomKeys(parameters.fingerprint);

  function createStore(): UsernameBloomStore {
    return new UsernameBloomStore();
  }

  function createService(): UsernameBloomService {
    return new UsernameBloomService(
      createStore(),
      config,
      loggerFactory.forComponent("username-bloom-test", "service"),
    );
  }

  async function runRebuild() {
    return rebuildUsernameBloom({
      store: createStore(),
      repository: persistenceApp.container.resolve(
        containerTokens.usernameBloomRepository,
      ),
      cacheService: persistenceApp.container.resolve(
        containerTokens.cacheService,
      ),
      config: {
        capacity: config.capacity,
        falsePositiveRate: config.falsePositiveRate,
        // Zero means "always due", so each test controls its own rebuilds.
        rebuildIntervalMs: 0,
        batchSize: 3,
        lockTtlMs: 30_000,
      },
      logger: loggerFactory.forComponent("username-bloom-test", "worker"),
    });
  }

  async function clearFilterKeys(): Promise<void> {
    const cacheService = persistenceApp.container.resolve(
      containerTokens.cacheService,
    );

    await cacheService.deleteByPattern("auth:username-bloom:*");
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 120_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await clearFilterKeys();
  }, 120_000);

  it("rebuilds from the profiles table and survives the Redis round trip", async () => {
    // The bitmap is binary, and a UTF-8 decode on the way back would corrupt
    // every byte above 0x7f. A seeded name reading back as absent is exactly
    // what that corruption looks like.
    const result = await runRebuild();

    expect(result.status).toBe("rebuilt");
    expect(result.usernameCount).toBeGreaterThan(0);

    const service = createService();
    await service.initialize();

    try {
      expect(service.isReady()).toBe(true);
      expect(service.check("owner-one")).toBe("possibly-present");
      expect(service.check("renter-one")).toBe("possibly-present");
      expect(service.check("nobody-has-ever-claimed-this")).toBe(
        "definitely-absent",
      );
    } finally {
      await service.dispose();
    }
  }, 120_000);

  it("pages through the table without missing rows at a batch boundary", async () => {
    const profiles = await persistenceApp.prisma.profile.findMany({
      select: { username: true },
    });
    const result = await runRebuild();

    expect(result.usernameCount).toBe(profiles.length);

    const service = createService();
    await service.initialize();

    try {
      for (const profile of profiles) {
        expect(service.check(profile.username)).toBe("possibly-present");
      }
    } finally {
      await service.dispose();
    }
  }, 120_000);

  it("stays unready until a rebuild has published metadata", async () => {
    // Before the first build the bit array is empty, and an empty array says
    // "absent" for everything. Answering from it would report every username in
    // the system as available.
    const service = createService();
    await service.initialize();

    try {
      expect(service.isReady()).toBe(false);
      expect(service.check("owner-one")).toBe("unknown");
    } finally {
      await service.dispose();
    }
  }, 120_000);

  it("propagates a claim to another instance over pub/sub", async () => {
    await runRebuild();

    const writer = createService();
    const reader = createService();
    await writer.initialize();
    await reader.initialize();

    try {
      expect(reader.check("brand-new-name")).toBe("definitely-absent");

      await writer.add("brand-new-name");
      await waitFor(
        () => reader.check("brand-new-name") === "possibly-present",
      );

      expect(reader.check("brand-new-name")).toBe("possibly-present");
    } finally {
      await writer.dispose();
      await reader.dispose();
    }
  }, 120_000);

  it("recovers a missed announcement on the next reload", async () => {
    // Redis pub/sub is at most once. A subscriber that was reconnecting has to
    // pick the name up from the shared bitmap instead.
    await runRebuild();

    const writer = createService();
    const reader = createService();
    await writer.initialize();
    await reader.initialize();

    try {
      await writer.add("written-while-deaf");
      // Simulate the message never arriving by reloading a fresh instance.
      const latecomer = createService();
      await latecomer.initialize();

      try {
        expect(latecomer.check("written-while-deaf")).toBe("possibly-present");
      } finally {
        await latecomer.dispose();
      }
    } finally {
      await writer.dispose();
      await reader.dispose();
    }
  }, 120_000);

  it("captures names claimed while a rebuild is in flight", async () => {
    await runRebuild();

    const writer = createService();
    await writer.initialize();

    try {
      const store = createStore();
      // Stand in for a rebuild that has registered its shadow but not yet
      // swapped: the add must be recorded for replay.
      await store.writeKey(keys.shadowPointer, "99");
      await writer.add("claimed-mid-rebuild");

      await expect(
        store.readReplayEntries(keys.replayList(99)),
      ).resolves.toEqual(["claimed-mid-rebuild"]);

      await store.delete([keys.shadowPointer, keys.replayList(99)]);
    } finally {
      await writer.dispose();
    }
  }, 120_000);

  it("sheds a released username on the next rebuild", async () => {
    const service = createService();
    await runRebuild();
    await service.initialize();

    try {
      await service.add("temporarily-claimed");
      expect(service.check("temporarily-claimed")).toBe("possibly-present");

      // Nothing in the database ever held that name, so a rebuild drops it.
      const result = await runRebuild();
      expect(result.status).toBe("rebuilt");

      await service.reload();
      expect(service.check("temporarily-claimed")).toBe("definitely-absent");
    } finally {
      await service.dispose();
    }
  }, 120_000);

  it("includes unverified signup reservations", async () => {
    const cacheService = persistenceApp.container.resolve(
      containerTokens.cacheService,
    );
    await cacheService.setJson(
      getPendingSignupUsernameKey("reserved-name"),
      "pending@example.com",
      600,
    );

    await runRebuild();

    const service = createService();
    await service.initialize();

    try {
      // A filter miss skips the reservation lookup too, so a reserved name has
      // to be in the bitmap or the endpoint would report it free.
      expect(service.check("reserved-name")).toBe("possibly-present");
    } finally {
      await service.dispose();
      await cacheService.delete(getPendingSignupUsernameKey("reserved-name"));
    }
  }, 120_000);

  it("answers the availability endpoint correctly on both paths", async () => {
    await runRebuild();

    const bloomService = persistenceApp.container.resolve(
      containerTokens.usernameBloomService,
    );
    await bloomService.initialize();

    const taken = await requestAvailability(
      `http://rent.test${buildApiPath("/auth/username/available?username=owner-one")}`,
    );
    const free = await requestAvailability(
      `http://rent.test${buildApiPath("/auth/username/available?username=nobody-has-ever-claimed-this")}`,
    );

    expect(taken.status).toBe(200);
    expect(taken.body.data).toMatchObject({
      username: "owner-one",
      available: false,
      reason: "taken",
    });
    expect(free.status).toBe(200);
    expect(free.body.data).toMatchObject({
      username: "nobody-has-ever-claimed-this",
      available: true,
      reason: null,
    });
  }, 120_000);

  it("keeps its keys namespaced by the configured parameters", async () => {
    // Changing capacity has to land on a fresh key rather than reinterpreting a
    // bitmap built for different sizing.
    await runRebuild();

    const cacheService = persistenceApp.container.resolve(
      containerTokens.cacheService,
    );
    const storedKeys = await cacheService.scanKeys("auth:username-bloom:*");

    expect(storedKeys.length).toBeGreaterThan(0);
    for (const key of storedKeys) {
      expect(key).toContain(parameters.fingerprint);
    }

    const otherParameters = deriveBloomParameters(50_000, 0.001);
    expect(otherParameters.fingerprint).not.toBe(parameters.fingerprint);
  }, 120_000);

  it("uses the sizing the environment declares", () => {
    const configured = environment.getUsernameBloomConfig();

    expect(configured.capacity).toBeGreaterThan(0);
    expect(configured.falsePositiveRate).toBeGreaterThan(0);
    expect(configured.falsePositiveRate).toBeLessThan(1);
    expect(configured.maxStalenessMs).toBeGreaterThan(
      configured.reloadIntervalMs,
    );
  });

  /**
   * The path stays a literal inside `buildApiPath` rather than being assembled
   * from a parameter. The OpenAPI operation-coverage gate resolves request
   * sites statically, and an interpolated URL reads as unresolved and fails it.
   */
  async function requestAvailability(url: string) {
    const response = await persistenceApp.app.request(url, {
      method: "GET",
      headers: { origin: ORIGIN },
    });

    return {
      status: response.status,
      body: (await response.json()) as { data?: Record<string, unknown> },
    };
  }

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (predicate()) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error("Timed out waiting for the bloom filter to converge.");
  }
});
