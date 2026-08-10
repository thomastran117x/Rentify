import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_STEP_IN_SECONDS = 30;
const DEFAULT_DIGITS = 6;

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
 * Generates a TOTP code the way an authenticator app would.
 *
 * This is deliberately an independent implementation rather than a call into
 * `TotpService`: the production service only exposes secret generation and code
 * verification, and a test that generated codes with the same code it verifies
 * them with would not prove the two sides agree.
 */
export function generateTotpCode(
  secret: string,
  options: {
    stepInSeconds?: number;
    digits?: number;
    timestampMs?: number;
  } = {},
): string {
  const stepInSeconds = options.stepInSeconds ?? DEFAULT_STEP_IN_SECONDS;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const timestampMs = options.timestampMs ?? Date.now();
  const counter = Math.floor(timestampMs / 1000 / stepInSeconds);

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

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Reads the base32 secret out of an `otpauth://` enrollment URI. */
export function readSecretFromOtpAuthUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");

  if (!secret) {
    throw new Error(`Enrollment URI does not carry a secret: ${uri}`);
  }

  return secret;
}
