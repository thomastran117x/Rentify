import {
  buildUsernameBloomKeys,
  isUsernameBloomEvent,
  USERNAME_BLOOM_CACHE_PREFIX,
} from "@/features/auth/username-bloom/username-bloom-keys";

describe("buildUsernameBloomKeys", () => {
  it("namespaces every key by the parameter fingerprint", () => {
    // Different sizing has to land on different keys, or a bitmap would be read
    // with parameters it was not built for.
    const keys = buildUsernameBloomKeys("abc123");

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

  it("gives each generation its own shadow and replay keys", () => {
    const keys = buildUsernameBloomKeys("abc123");

    expect(keys.shadowBits(1)).not.toBe(keys.shadowBits(2));
    expect(keys.replayList(1)).not.toBe(keys.replayList(2));
  });

  it("keeps the shadow bitmap distinct from the live one", () => {
    const keys = buildUsernameBloomKeys("abc123");

    expect(keys.shadowBits(1)).not.toBe(keys.bits);
  });
});

describe("isUsernameBloomEvent", () => {
  it("accepts well-formed events", () => {
    expect(isUsernameBloomEvent({ type: "add", usernames: [] })).toBe(true);
    expect(
      isUsernameBloomEvent({ type: "add", usernames: ["casey-doe"] }),
    ).toBe(true);
    expect(isUsernameBloomEvent({ type: "rebuilt", generation: 3 })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "add"],
    ["a number", 7],
    ["undefined", undefined],
    ["an unknown type", { type: "nonsense" }],
    ["an add without usernames", { type: "add" }],
    ["an add whose usernames are not a list", { type: "add", usernames: "a" }],
    ["an add containing a non-string", { type: "add", usernames: [1] }],
    ["a rebuilt without a generation", { type: "rebuilt" }],
    [
      "a rebuilt whose generation is not a number",
      { type: "rebuilt", generation: "3" },
    ],
  ])("rejects %s", (_label, value) => {
    expect(isUsernameBloomEvent(value)).toBe(false);
  });
});
