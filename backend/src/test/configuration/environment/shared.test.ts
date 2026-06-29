import { MINIMUM_TOKEN_SECRET_LENGTH } from "@/configuration/environment/constants";
import {
  normalizeBaseUrl,
  normalizeDelimitedList,
  normalizeOptionalString,
  normalizeRawEnvironment,
  parseBoolean,
  parseNumber,
  readRequiredSecret,
  readRequiredString,
} from "@/configuration/environment/shared";

describe("environment shared helpers", () => {
  it("normalizes optional strings and delimited lists", () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined();
    expect(normalizeOptionalString("   ")).toBeUndefined();
    expect(normalizeOptionalString("  value  ")).toBe("value");
    expect(normalizeDelimitedList(undefined)).toEqual([]);
    expect(normalizeDelimitedList(" one, two ,, three ")).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("normalizes base urls and boolean values", () => {
    expect(normalizeBaseUrl("https://rent.example///")).toBe(
      "https://rent.example",
    );
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean("true", false)).toBe(true);
    expect(parseBoolean("YES", false)).toBe(true);
    expect(parseBoolean("off", true)).toBe(false);
  });

  it("copies only known trimmed environment variables into the raw state", () => {
    const raw = normalizeRawEnvironment({
      DATABASE_URL: " mysql://rent ",
      FRONTEND_URL: " https://rent.example ",
      MFA_BYPASS_EMAILS: " owner1@rentify.local,user1@rentify.local ",
      UNKNOWN_KEY: "ignored",
      EMPTY_VALUE: "   ",
    } as NodeJS.ProcessEnv);

    expect(raw.DATABASE_URL).toBe("mysql://rent");
    expect(raw.FRONTEND_URL).toBe("https://rent.example");
    expect(raw.MFA_BYPASS_EMAILS).toBe(
      "owner1@rentify.local,user1@rentify.local",
    );
    expect("UNKNOWN_KEY" in raw).toBe(false);
  });

  it("parses numbers and records validation errors for invalid values", () => {
    const errors: string[] = [];
    const raw = {
      REDIS_PORT: "bad",
      REDIS_DB: "2.5",
      REDIS_CONNECT_TIMEOUT_MS: "0",
      ACCESS_TOKEN_TTL_SECONDS: "999",
    };

    expect(
      parseNumber(raw, "REDIS_PORT", 6379, errors, { integer: true, min: 1 }),
    ).toBe(6379);
    expect(
      parseNumber(raw, "REDIS_DB", 0, errors, { integer: true, min: 0 }),
    ).toBe(0);
    expect(
      parseNumber(raw, "REDIS_CONNECT_TIMEOUT_MS", 1000, errors, {
        integer: true,
        min: 1,
      }),
    ).toBe(1000);
    expect(
      parseNumber(raw, "ACCESS_TOKEN_TTL_SECONDS", 60, errors, {
        max: 100,
      }),
    ).toBe(60);
    expect(errors).toEqual([
      "REDIS_PORT must be a valid number.",
      "REDIS_DB must be an integer.",
      "REDIS_CONNECT_TIMEOUT_MS must be greater than or equal to 1.",
      "ACCESS_TOKEN_TTL_SECONDS must be less than or equal to 100.",
    ]);
  });

  it("reads required strings and secrets while recording missing or short values", () => {
    const errors: string[] = [];
    const raw = {
      DATABASE_URL: "mysql://rent",
      ACCESS_TOKEN_SECRET: "short-secret",
    };

    expect(readRequiredString(raw, "DATABASE_URL", errors)).toBe(
      "mysql://rent",
    );
    expect(readRequiredString(raw, "FRONTEND_URL", errors)).toBe("");
    expect(readRequiredSecret(raw, "ACCESS_TOKEN_SECRET", errors)).toBe(
      "short-secret",
    );
    expect(errors).toEqual([
      "FRONTEND_URL is required.",
      `ACCESS_TOKEN_SECRET must be at least ${MINIMUM_TOKEN_SECRET_LENGTH} characters long.`,
    ]);
  });
});
