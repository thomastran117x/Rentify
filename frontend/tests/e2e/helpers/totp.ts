import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_IN_SECONDS = 30;
const DIGITS = 6;

function base32Decode(input: string): Buffer {
  const normalized = input.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${character}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates an RFC 6238 code the way an authenticator app would, so a spec can
 * sign in to an account it enrolled. Mirrors the backend's test-only client.
 */
export function generateTotpCode(secret: string, timestampMs = Date.now()) {
  const counter = Math.floor(timestampMs / 1000 / STEP_IN_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = hmac[19]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}
