import { deriveBloomParameters } from "@/features/auth/username-bloom/bloom-parameters";
import { LocalBloomFilter } from "@/features/auth/username-bloom/local-bloom-filter";

describe("LocalBloomFilter", () => {
  it("never reports a member as absent", () => {
    // The load-bearing property. A false positive costs one wasted query, but a
    // false negative makes the endpoint report a taken username as available.
    const filter = new LocalBloomFilter(deriveBloomParameters(5_000, 0.01));
    const members = Array.from(
      { length: 5_000 },
      (_, index) => `member-${index}`,
    );

    for (const member of members) {
      filter.add(member);
    }

    for (const member of members) {
      expect(filter.has(member)).toBe(true);
    }
  });

  it("holds its false positive rate near the configured target", () => {
    const capacity = 5_000;
    const targetRate = 0.01;
    const filter = new LocalBloomFilter(
      deriveBloomParameters(capacity, targetRate),
    );

    for (let index = 0; index < capacity; index += 1) {
      filter.add(`member-${index}`);
    }

    const probeCount = 50_000;
    let falsePositives = 0;

    for (let index = 0; index < probeCount; index += 1) {
      if (filter.has(`stranger-${index}`)) {
        falsePositives += 1;
      }
    }

    expect(falsePositives / probeCount).toBeLessThan(targetRate * 2);
  });

  it("reports absence for an untouched filter", () => {
    const filter = new LocalBloomFilter(deriveBloomParameters(1_000, 0.01));

    expect(filter.has("casey-doe")).toBe(false);
    expect(filter.countSetBits()).toBe(0);
  });

  it("normalizes case and surrounding space", () => {
    const filter = new LocalBloomFilter(deriveBloomParameters(1_000, 0.01));

    filter.add("Casey-Doe");

    expect(filter.has("casey-doe")).toBe(true);
    expect(filter.has("  CASEY-DOE ")).toBe(true);
  });

  it("returns the indices it set so a caller can reuse them", () => {
    const filter = new LocalBloomFilter(deriveBloomParameters(1_000, 0.01));
    const indices = filter.add("casey-doe");

    expect(indices).toEqual(filter.getIndices("casey-doe"));
    expect(filter.hasIndices(indices)).toBe(true);
  });

  it("is idempotent for a repeated name", () => {
    const filter = new LocalBloomFilter(deriveBloomParameters(1_000, 0.01));

    filter.add("casey-doe");
    const afterFirst = filter.countSetBits();
    filter.add("casey-doe");

    expect(filter.countSetBits()).toBe(afterFirst);
  });

  it("round-trips through a buffer", () => {
    const parameters = deriveBloomParameters(1_000, 0.01);
    const source = new LocalBloomFilter(parameters);

    source.add("casey-doe");
    source.add("river-stone");

    const restored = new LocalBloomFilter(parameters);
    restored.replaceFrom(source.toBuffer());

    expect(restored.has("casey-doe")).toBe(true);
    expect(restored.has("river-stone")).toBe(true);
    expect(restored.countSetBits()).toBe(source.countSetBits());
  });

  it("survives bytes above 0x7f, which a text round trip would corrupt", () => {
    const parameters = deriveBloomParameters(1_000, 0.01);
    const filter = new LocalBloomFilter(parameters);
    const bytes = new Uint8Array(parameters.byteLength);
    bytes[0] = 0x81;
    bytes[1] = 0xff;

    filter.replaceFrom(bytes);

    expect(filter.toBuffer()[0]).toBe(0x81);
    expect(filter.toBuffer()[1]).toBe(0xff);
  });

  it("accepts a short buffer and zero-fills the rest", () => {
    // Redis grows a bitmap only as far as its highest set bit, so a sparse
    // filter comes back truncated rather than padded.
    const parameters = deriveBloomParameters(1_000, 0.01);
    const filter = new LocalBloomFilter(parameters);

    filter.replaceFrom(new Uint8Array([0b1000_0000]));

    expect(filter.toBuffer()).toHaveLength(parameters.byteLength);
    expect(filter.countSetBits()).toBe(1);
  });

  it("refuses a buffer larger than the configured bitmap", () => {
    // An oversized bitmap was built with different parameters. Reading it with
    // the current ones would misplace every probe and produce false negatives.
    const parameters = deriveBloomParameters(1_000, 0.01);
    const filter = new LocalBloomFilter(parameters);

    expect(() =>
      filter.replaceFrom(new Uint8Array(parameters.byteLength + 1)),
    ).toThrow(/does not match|configured size/i);
    expect(() =>
      filter.mergeFrom(new Uint8Array(parameters.byteLength + 1)),
    ).toThrow(/configured size/i);
  });

  it("replaces rather than merges, dropping bits absent from the new bitmap", () => {
    const parameters = deriveBloomParameters(1_000, 0.01);
    const filter = new LocalBloomFilter(parameters);

    filter.add("casey-doe");
    filter.replaceFrom(new Uint8Array(parameters.byteLength));

    expect(filter.has("casey-doe")).toBe(false);
  });

  it("keeps existing bits when merging", () => {
    // A same-generation reload merges so that names added locally since the
    // read began are not erased by an older snapshot.
    const parameters = deriveBloomParameters(1_000, 0.01);
    const remote = new LocalBloomFilter(parameters);
    remote.add("river-stone");

    const local = new LocalBloomFilter(parameters);
    local.add("casey-doe");
    local.mergeFrom(remote.toBuffer());

    expect(local.has("casey-doe")).toBe(true);
    expect(local.has("river-stone")).toBe(true);
  });

  it("clears every bit", () => {
    const filter = new LocalBloomFilter(deriveBloomParameters(1_000, 0.01));

    filter.add("casey-doe");
    filter.clear();

    expect(filter.has("casey-doe")).toBe(false);
    expect(filter.countSetBits()).toBe(0);
  });

  it("counts set bits across byte boundaries", () => {
    const parameters = deriveBloomParameters(1_000, 0.01);
    const filter = new LocalBloomFilter(parameters);

    filter.addIndices([0, 7, 8, 15, 16]);

    expect(filter.countSetBits()).toBe(5);
    expect(filter.hasIndices([0, 7, 8, 15, 16])).toBe(true);
    expect(filter.hasIndices([0, 1])).toBe(false);
  });

  it("lays bits out most-significant-first, matching Redis bitmaps", () => {
    // Redis SETBIT offset 0 addresses the top bit of byte 0. Disagreeing here
    // would make a bitmap written by the rebuild unreadable by the service.
    const parameters = deriveBloomParameters(1_000, 0.01);
    const filter = new LocalBloomFilter(parameters);

    filter.addIndices([0]);

    expect(filter.toBuffer()[0]).toBe(0b1000_0000);
  });
});
