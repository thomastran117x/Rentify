import {
  BLOOM_HASH_VERSION,
  deriveBloomParameters,
  estimateFalsePositiveRate,
} from "@/features/auth/identity-bloom/bloom-parameters";

describe("deriveBloomParameters", () => {
  it("sizes the bitmap and probe count from the standard bloom formulas", () => {
    const parameters = deriveBloomParameters(200_000, 0.01);

    // m = -n*ln(p)/(ln2)^2 ~= 1_917_011 bits, rounded up to whole bytes.
    expect(parameters.bitCount).toBe(1_917_016);
    expect(parameters.byteLength).toBe(239_627);
    expect(parameters.hashCount).toBe(7);
  });

  it("always produces a bit count that fills whole bytes", () => {
    for (const capacity of [1, 17, 1_000, 123_457]) {
      const parameters = deriveBloomParameters(capacity, 0.01);

      expect(parameters.bitCount).toBe(parameters.byteLength * 8);
      expect(parameters.bitCount % 8).toBe(0);
    }
  });

  it("demands a larger bitmap for a stricter false positive rate", () => {
    const lenient = deriveBloomParameters(10_000, 0.1);
    const strict = deriveBloomParameters(10_000, 0.001);

    expect(strict.bitCount).toBeGreaterThan(lenient.bitCount);
    expect(strict.hashCount).toBeGreaterThan(lenient.hashCount);
  });

  it("keeps at least one probe even when the target rate is very loose", () => {
    expect(deriveBloomParameters(1_000, 0.99).hashCount).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("produces a stable fingerprint for the same parameters", () => {
    expect(deriveBloomParameters(50_000, 0.01).fingerprint).toBe(
      deriveBloomParameters(50_000, 0.01).fingerprint,
    );
  });

  it("changes the fingerprint when the sizing changes", () => {
    // The fingerprint namespaces the Redis keys. Different sizing has to land on
    // different keys, or a bitmap would be read with parameters it was not
    // built for and start reporting names it contains as absent.
    expect(deriveBloomParameters(50_000, 0.01).fingerprint).not.toBe(
      deriveBloomParameters(90_000, 0.01).fingerprint,
    );
    expect(deriveBloomParameters(50_000, 0.01).fingerprint).not.toBe(
      deriveBloomParameters(50_000, 0.001).fingerprint,
    );
  });

  it("exposes the hash version that the fingerprint is derived from", () => {
    expect(BLOOM_HASH_VERSION).toBe(1);
  });

  it.each([
    ["a fractional capacity", 1.5, 0.01],
    ["a zero capacity", 0, 0.01],
    ["a negative capacity", -10, 0.01],
  ])("rejects %s", (_label, capacity, rate) => {
    expect(() => deriveBloomParameters(capacity, rate)).toThrow(
      /capacity must be a positive integer/i,
    );
  });

  it.each([
    ["a rate of zero", 0],
    ["a rate of one", 1],
    ["a negative rate", -0.5],
    ["a rate above one", 1.5],
    ["a non-finite rate", Number.NaN],
  ])("rejects %s", (_label, rate) => {
    expect(() => deriveBloomParameters(1_000, rate)).toThrow(
      /false positive rate/i,
    );
  });
});

describe("estimateFalsePositiveRate", () => {
  it("reports no false positives for an empty filter", () => {
    expect(
      estimateFalsePositiveRate({ bitCount: 1_000, hashCount: 3 }, 0),
    ).toBe(0);
    expect(
      estimateFalsePositiveRate({ bitCount: 1_000, hashCount: 3 }, -5),
    ).toBe(0);
  });

  it("lands near the target rate at the capacity the filter was sized for", () => {
    const parameters = deriveBloomParameters(100_000, 0.01);

    expect(estimateFalsePositiveRate(parameters, 100_000)).toBeCloseTo(0.01, 2);
  });

  it("degrades as the filter fills past its capacity", () => {
    const parameters = deriveBloomParameters(100_000, 0.01);
    const atCapacity = estimateFalsePositiveRate(parameters, 100_000);
    const overCapacity = estimateFalsePositiveRate(parameters, 400_000);

    expect(overCapacity).toBeGreaterThan(atCapacity * 10);
  });
});
