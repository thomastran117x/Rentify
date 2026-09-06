import {
  buildIdentityBloomKeys,
  parseIdentityBloomEvent,
} from "@/features/auth/identity-bloom/identity-bloom-keys";
import {
  EMAIL_BLOOM_CACHE_PREFIX,
  emailBloomSubject,
  USERNAME_BLOOM_CACHE_PREFIX,
  usernameBloomSubject,
} from "@/features/auth/identity-bloom/identity-bloom-subject";

describe("buildIdentityBloomKeys", () => {
  it("namespaces every key by the parameter fingerprint", () => {
    // Different sizing has to land on different keys, or a bitmap would be read
    // with parameters it was not built for.
    const keys = buildIdentityBloomKeys(
      usernameBloomSubject.cachePrefix,
      "abc123",
    );

    for (const key of [
      keys.bits,
      keys.meta,
      keys.channel,
      keys.rebuildLock,
      keys.shadowPointer,
      keys.shadowBits(2),
      keys.replayList(2),
    ]) {
      expect(key.startsWith(`${USERNAME_BLOOM_CACHE_PREFIX}:abc123:`)).toBe(
        true,
      );
    }
  });

  it("gives each subject its own keyspace", () => {
    // Two filters sized identically derive the same fingerprint, so the prefix
    // is the only thing keeping usernames out of the email bitmap.
    const usernameKeys = buildIdentityBloomKeys(
      usernameBloomSubject.cachePrefix,
      "abc123",
    );
    const emailKeys = buildIdentityBloomKeys(
      emailBloomSubject.cachePrefix,
      "abc123",
    );

    expect(usernameKeys.bits).not.toBe(emailKeys.bits);
    expect(usernameKeys.channel).not.toBe(emailKeys.channel);
    expect(
      emailKeys.bits.startsWith(`${EMAIL_BLOOM_CACHE_PREFIX}:abc123:`),
    ).toBe(true);
  });

  it("gives each generation its own shadow and replay keys", () => {
    const keys = buildIdentityBloomKeys(
      usernameBloomSubject.cachePrefix,
      "abc123",
    );

    expect(keys.shadowBits(1)).not.toBe(keys.shadowBits(2));
    expect(keys.replayList(1)).not.toBe(keys.replayList(2));
  });

  it("keeps the shadow bitmap distinct from the live one", () => {
    const keys = buildIdentityBloomKeys(
      usernameBloomSubject.cachePrefix,
      "abc123",
    );

    expect(keys.shadowBits(1)).not.toBe(keys.bits);
  });
});

describe("parseIdentityBloomEvent", () => {
  it("accepts well-formed events", () => {
    expect(parseIdentityBloomEvent({ type: "add", values: [] })).toEqual({
      type: "add",
      values: [],
    });
    expect(
      parseIdentityBloomEvent({ type: "add", values: ["casey-doe"] }),
    ).toEqual({ type: "add", values: ["casey-doe"] });
    expect(parseIdentityBloomEvent({ type: "rebuilt", generation: 3 })).toEqual(
      {
        type: "rebuilt",
        generation: 3,
      },
    );
  });

  it("reads the pre-rename usernames field as values", () => {
    // A rolling deploy has old instances still publishing this spelling, and
    // dropping their events would leave new instances briefly unaware of names
    // claimed elsewhere.
    expect(
      parseIdentityBloomEvent({ type: "add", usernames: ["casey-doe"] }),
    ).toEqual({ type: "add", values: ["casey-doe"] });
  });

  it.each([
    ["null", null],
    ["a string", "add"],
    ["a number", 7],
    ["undefined", undefined],
    ["an unknown type", { type: "nonsense" }],
    ["an add without values", { type: "add" }],
    ["an add whose values are not a list", { type: "add", values: "a" }],
    ["an add containing a non-string", { type: "add", values: [1] }],
    ["a rebuilt without a generation", { type: "rebuilt" }],
    [
      "a rebuilt whose generation is not a number",
      { type: "rebuilt", generation: "3" },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseIdentityBloomEvent(value)).toBeNull();
  });
});
