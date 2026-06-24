import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let result = "";
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  if (bitsLeft > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);

    if (value === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function counterToBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

function computeHotp(
  secretBytes: Buffer,
  counter: number,
  digits: number,
): string {
  const hmac = createHmac("sha1", secretBytes)
    .update(counterToBuffer(counter))
    .digest();

  const offset = hmac[19] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (truncated % 10 ** digits).toString().padStart(digits, "0");
}

interface TotpServiceOptions {
  issuer: string;
  stepInSeconds?: number;
  digits?: number;
  windowSize?: number;
}

export interface GeneratedTotpSecret {
  secret: string;
  uri: string;
}

const DEFAULTS = {
  stepInSeconds: 30,
  digits: 6,
  windowSize: 1,
} as const;

export class TotpService {
  private readonly issuer: string;
  private readonly stepInSeconds: number;
  private readonly digits: number;
  private readonly windowSize: number;
  private readonly codePattern: RegExp;

  constructor(options: TotpServiceOptions) {
    this.issuer = options.issuer;
    this.stepInSeconds = options.stepInSeconds ?? DEFAULTS.stepInSeconds;
    this.digits = options.digits ?? DEFAULTS.digits;
    this.windowSize = options.windowSize ?? DEFAULTS.windowSize;
    this.codePattern = new RegExp(`^\\d{${this.digits}}$`);
  }

  generateSecret(accountName: string): GeneratedTotpSecret {
    const secret = base32Encode(randomBytes(20));
    const label = `${encodeURIComponent(this.issuer)}:${encodeURIComponent(accountName)}`;
    const params = new URLSearchParams({
      secret,
      issuer: this.issuer,
      algorithm: "SHA1",
      digits: String(this.digits),
      period: String(this.stepInSeconds),
    });

    return { secret, uri: `otpauth://totp/${label}?${params.toString()}` };
  }

  // Returns the matched TOTP counter value on success, or null on failure.
  // The caller can use the counter to enforce replay protection (reject codes
  // at or below a stored lastUsedCounter).
  verifyCode(secret: string, code: string): number | null {
    const normalizedCode = code.trim();

    if (!this.codePattern.test(normalizedCode)) {
      return null;
    }

    let secretBytes: Buffer;
    try {
      secretBytes = base32Decode(secret);
    } catch {
      return null;
    }

    const counter = Math.floor(Date.now() / 1000 / this.stepInSeconds);
    const inputBuf = Buffer.from(normalizedCode);

    for (
      let t = counter - this.windowSize;
      t <= counter + this.windowSize;
      t++
    ) {
      const expected = computeHotp(secretBytes, t, this.digits);

      if (timingSafeEqual(Buffer.from(expected), inputBuf)) {
        return t;
      }
    }

    return null;
  }
}
