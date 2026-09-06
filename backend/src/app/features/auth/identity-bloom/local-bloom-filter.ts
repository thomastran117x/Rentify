/**
 * The in-process (L1) half of an identity bloom filter.
 *
 * Holds the bit array in a `Uint8Array` so a membership question costs no I/O
 * at all. The bytes are laid out exactly as Redis stores a bitmap — bit 0 is
 * the most significant bit of byte 0 — so a buffer read straight out of Redis
 * can be adopted without translation, and a buffer produced here can be written
 * back with a single `SET`.
 */

import {
  getBitIndices,
  type BloomNormalizer,
} from "@/features/auth/identity-bloom/bloom-hash";
import type { BloomParameters } from "@/features/auth/identity-bloom/bloom-parameters";

export class LocalBloomFilter {
  private bits: Uint8Array;

  constructor(
    public readonly parameters: BloomParameters,
    private readonly normalize: BloomNormalizer,
  ) {
    this.bits = new Uint8Array(parameters.byteLength);
  }

  getIndices(value: string): number[] {
    return getBitIndices(
      value,
      this.parameters.bitCount,
      this.parameters.hashCount,
      this.normalize,
    );
  }

  /**
   * Adds `value` and returns the indices it occupied, so the caller can reuse
   * them for the matching Redis write instead of hashing twice.
   */
  add(value: string): number[] {
    const indices = this.getIndices(value);
    this.addIndices(indices);

    return indices;
  }

  addIndices(indices: number[]): void {
    for (const index of indices) {
      this.bits[index >>> 3] |= 0b1000_0000 >>> (index & 7);
    }
  }

  has(value: string): boolean {
    return this.hasIndices(this.getIndices(value));
  }

  hasIndices(indices: number[]): boolean {
    for (const index of indices) {
      if ((this.bits[index >>> 3]! & (0b1000_0000 >>> (index & 7))) === 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Adopts a bitmap read from Redis.
   *
   * A shorter buffer is normal rather than an error: Redis grows a bitmap only
   * as far as its highest set bit, so a sparsely populated filter comes back
   * truncated and the missing tail is all zeroes. A *longer* buffer means the
   * stored bitmap was built with different sizing, which would produce false
   * negatives if read with the current parameters, so it is refused outright.
   */
  replaceFrom(bytes: Uint8Array): void {
    if (bytes.length > this.parameters.byteLength) {
      throw new Error(
        `Bloom bitmap is ${bytes.length} bytes but the configured size is ${this.parameters.byteLength} bytes.`,
      );
    }

    const next = new Uint8Array(this.parameters.byteLength);
    next.set(bytes);
    this.bits = next;
  }

  /**
   * Merges another bitmap in rather than replacing it. Used when reloading
   * after local writes may have landed since the read started: dropping those
   * bits would reintroduce the false negative the reload exists to prevent.
   */
  mergeFrom(bytes: Uint8Array): void {
    if (bytes.length > this.parameters.byteLength) {
      throw new Error(
        `Bloom bitmap is ${bytes.length} bytes but the configured size is ${this.parameters.byteLength} bytes.`,
      );
    }

    for (let offset = 0; offset < bytes.length; offset += 1) {
      this.bits[offset]! |= bytes[offset]!;
    }
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bits);
  }

  clear(): void {
    this.bits = new Uint8Array(this.parameters.byteLength);
  }

  /** Count of set bits, used to estimate saturation. */
  countSetBits(): number {
    let total = 0;

    for (const byte of this.bits) {
      let value = byte;

      while (value) {
        value &= value - 1;
        total += 1;
      }
    }

    return total;
  }
}
