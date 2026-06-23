import { createHmac } from "node:crypto";
import { TotpService } from "@/features/auth/mfa/totp/totp.service";

// RFC 4226 HOTP test secret: "12345678901234567890" in base32
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

// RFC 4226 Appendix D — HOTP values for counters 0–9 (6 digits)
// These are authoritative external values, not derived from this codebase.
const RFC_HOTP_VECTORS: Record<number, string> = {
  0: "755224",
  1: "287082",
  2: "359152",
  3: "969429",
  4: "338314",
};

// Helper: compute expected TOTP code using a minimal independent implementation.
// Used only to generate reference values for window/boundary tests — the RFC
// vector tests above protect against algorithm bugs in both this helper and the
// service having the same mistake.
function computeExpectedCode(
  secret: string,
  counter: number,
  digits = 6,
): string {
  const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/, "");
  const byteArr: number[] = [];
  let buf = 0;
  let bits = 0;

  for (const ch of normalized) {
    const v = BASE32.indexOf(ch);
    if (v === -1) throw new Error(`Invalid base32 char: ${ch}`);
    buf = (buf << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      byteArr.push((buf >> bits) & 0xff);
    }
  }

  const secretBuf = Buffer.from(byteArr);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", secretBuf).update(counterBuf).digest();
  const offset = hmac[19] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (truncated % 10 ** digits).toString().padStart(digits, "0");
}

function pinTime(counter: number, stepInSeconds = 30): void {
  jest.spyOn(Date, "now").mockReturnValue(counter * stepInSeconds * 1000);
}

function createService(overrides?: {
  issuer?: string;
  windowSize?: number;
  stepInSeconds?: number;
}) {
  return new TotpService({
    issuer: overrides?.issuer ?? "TestApp",
    windowSize: overrides?.windowSize,
    stepInSeconds: overrides?.stepInSeconds,
  });
}

describe("TotpService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("RFC 4226 HOTP vectors", () => {
    it("produces correct codes for authoritative HOTP test vectors", () => {
      const service = createService({ windowSize: 0 });

      for (const [counter, expectedCode] of Object.entries(RFC_HOTP_VECTORS)) {
        pinTime(Number(counter));
        expect(service.verifyCode(RFC_SECRET, expectedCode)).toBe(true);
      }
    });
  });

  describe("generateSecret", () => {
    it("returns a base32 secret of at least 32 characters", () => {
      const { secret } = createService().generateSecret("user@example.com");
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });

    it("returns a well-formed otpauth:// URI", () => {
      const { uri } = createService({ issuer: "MyApp" }).generateSecret(
        "user@example.com",
      );
      const url = new URL(uri);

      expect(url.protocol).toBe("otpauth:");
      expect(url.host).toBe("totp");
      expect(url.searchParams.get("issuer")).toBe("MyApp");
      expect(url.searchParams.get("algorithm")).toBe("SHA1");
      expect(url.searchParams.get("digits")).toBe("6");
      expect(url.searchParams.get("period")).toBe("30");
      expect(url.searchParams.get("secret")).toMatch(/^[A-Z2-7]+$/);
    });

    it("URL-encodes account names containing @ signs", () => {
      const { uri } = createService().generateSecret("thomas@example.com");
      expect(uri).toContain(encodeURIComponent("thomas@example.com"));
    });

    it("URL-encodes account names containing spaces", () => {
      const { uri } = createService().generateSecret("Thomas Tran");
      expect(uri).toContain(encodeURIComponent("Thomas Tran"));
    });

    it("URL-encodes account names containing colons", () => {
      const { uri } = createService().generateSecret("Issuer:Admin");
      expect(uri).toContain(encodeURIComponent("Issuer:Admin"));
    });

    it("includes the issuer in both the URI label and the issuer query param", () => {
      const { uri } = createService({ issuer: "Rent" }).generateSecret(
        "user@example.com",
      );
      expect(uri).toContain(encodeURIComponent("Rent"));
      expect(new URL(uri).searchParams.get("issuer")).toBe("Rent");
    });
  });

  describe("verifyCode", () => {
    it("accepts the current step code (T+0)", () => {
      const service = createService({ windowSize: 0 });
      pinTime(1);
      const expected = computeExpectedCode(RFC_SECRET, 1);
      expect(service.verifyCode(RFC_SECRET, expected)).toBe(true);
    });

    it("accepts a code from the previous step (T-1) within window", () => {
      const service = createService({ windowSize: 1 });
      pinTime(2); // current counter = 2, T-1 = counter 1 → RFC vector "287082"
      expect(service.verifyCode(RFC_SECRET, RFC_HOTP_VECTORS[1])).toBe(true);
    });

    it("accepts a code from the next step (T+1) within window", () => {
      const service = createService({ windowSize: 1 });
      pinTime(1); // current counter = 1, T+1 = counter 2 → RFC vector "359152"
      expect(service.verifyCode(RFC_SECRET, RFC_HOTP_VECTORS[2])).toBe(true);
    });

    it("rejects a code from T-2 when windowSize is 1", () => {
      const service = createService({ windowSize: 1 });
      pinTime(2); // current counter = 2, T-2 = counter 0 → "755224"
      expect(service.verifyCode(RFC_SECRET, RFC_HOTP_VECTORS[0])).toBe(false);
    });

    it("rejects a code from T+2 when windowSize is 1", () => {
      const service = createService({ windowSize: 1 });
      pinTime(1); // current counter = 1, T+2 = counter 3 → "969429"
      expect(service.verifyCode(RFC_SECRET, RFC_HOTP_VECTORS[3])).toBe(false);
    });

    it("accepts a leading-zero code correctly", () => {
      // Counter 4 code is "338314" — find one with a leading zero by searching.
      // computeExpectedCode is used to locate a known leading-zero code at a
      // specific counter, which is then verified against the service.
      const service = createService({ windowSize: 0 });
      let leadingZeroCounter: number | undefined;
      let leadingZeroCode: string | undefined;

      for (let c = 0; c < 1000; c++) {
        const code = computeExpectedCode(RFC_SECRET, c);

        if (code.startsWith("0")) {
          leadingZeroCounter = c;
          leadingZeroCode = code;
          break;
        }
      }

      expect(leadingZeroCode).toBeDefined();
      expect(leadingZeroCode!.startsWith("0")).toBe(true);

      pinTime(leadingZeroCounter!);
      expect(service.verifyCode(RFC_SECRET, leadingZeroCode!)).toBe(true);
    });

    it("returns false for a wrong code", () => {
      const service = createService();
      const { secret } = service.generateSecret("test");
      expect(service.verifyCode(secret, "000000")).toBe(false);
    });

    it("returns false for non-numeric input", () => {
      const service = createService();
      const { secret } = service.generateSecret("test");
      expect(service.verifyCode(secret, "abc123")).toBe(false);
      expect(service.verifyCode(secret, "AAAAAA")).toBe(false);
    });

    it("returns false for codes of wrong length", () => {
      const service = createService();
      const { secret } = service.generateSecret("test");
      expect(service.verifyCode(secret, "12345")).toBe(false);
      expect(service.verifyCode(secret, "1234567")).toBe(false);
      expect(service.verifyCode(secret, "")).toBe(false);
    });

    it("accepts a lowercase base32 secret by normalising to uppercase", () => {
      const service = createService({ windowSize: 0 });
      pinTime(1);
      const expected = RFC_HOTP_VECTORS[1];
      expect(service.verifyCode(RFC_SECRET.toLowerCase(), expected)).toBe(true);
    });

    it("returns false for a secret with invalid base32 characters", () => {
      const service = createService();
      expect(service.verifyCode("INVALID!@#SECRET", "123456")).toBe(false);
    });

    it("trims surrounding whitespace from the code", () => {
      const service = createService({ windowSize: 0 });
      pinTime(1);
      const expected = RFC_HOTP_VECTORS[1];
      expect(service.verifyCode(RFC_SECRET, ` ${expected} `)).toBe(true);
    });
  });
});
