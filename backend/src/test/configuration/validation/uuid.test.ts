import { ZodError } from "zod";
import {
  UUID_PATTERN,
  UUID_PATTERN_SOURCE,
  asOptionalUuid,
  asUuid,
  isUuid,
  newUuid,
  parseUuid,
  uuidSchema,
  uuidSchemaWithMessage,
} from "@/configuration/validation/uuid";

// The shape that motivates z.guid() over z.uuid(): createFixtureId builds these
// with a zero version nibble, so they are not RFC 4122 but are valid ids here.
const SEEDED_ID = "00000000-0000-0000-1040-000000000016";
const RANDOM_V4_ID = "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f";
const UPPERCASE_ID = "6F1C8B2E-6B0A-4F0E-9B6E-2F9A1C2D3E4F";

describe("uuid", () => {
  describe("isUuid", () => {
    it.each([
      ["a seeded fixture id", SEEDED_ID],
      ["a random v4 id", RANDOM_V4_ID],
      ["uppercase hexadecimal", UPPERCASE_ID],
    ])("accepts %s", (_label, value) => {
      expect(isUuid(value)).toBe(true);
    });

    it.each([
      ["an arbitrary string", "not-a-uuid"],
      ["an empty string", ""],
      ["a whitespace-padded id", ` ${RANDOM_V4_ID} `],
      ["a truncated id", RANDOM_V4_ID.slice(0, 35)],
      ["an over-long id", `${RANDOM_V4_ID}0`],
      ["non-hexadecimal characters", "gggggggg-6b0a-4f0e-9b6e-2f9a1c2d3e4f"],
      ["a slug that is otherwise id-shaped", "harbor-rentals"],
      ["an id without separators", RANDOM_V4_ID.replaceAll("-", "")],
    ])("rejects %s", (_label, value) => {
      expect(isUuid(value)).toBe(false);
    });

    it("anchors both ends so an embedded id is not accepted", () => {
      expect(isUuid(`prefix-${RANDOM_V4_ID}`)).toBe(false);
      expect(isUuid(`${RANDOM_V4_ID}-suffix`)).toBe(false);
    });
  });

  describe("UUID_PATTERN", () => {
    it("is compiled from the source string that OpenAPI publishes", () => {
      expect(UUID_PATTERN.source).toBe(UUID_PATTERN_SOURCE);
    });

    it("is stateless across calls", () => {
      // A `g` flag would make `test` advance lastIndex and alternate results.
      expect(UUID_PATTERN.test(RANDOM_V4_ID)).toBe(true);
      expect(UUID_PATTERN.test(RANDOM_V4_ID)).toBe(true);
    });
  });

  describe("uuidSchema", () => {
    it("parses a seeded fixture id", () => {
      expect(uuidSchema.parse(SEEDED_ID)).toBe(SEEDED_ID);
    });

    it("agrees with isUuid on uppercase input", () => {
      expect(uuidSchema.parse(UPPERCASE_ID)).toBe(UPPERCASE_ID);
    });

    it("does not trim, so padded input must be trimmed upstream", () => {
      expect(uuidSchema.safeParse(` ${RANDOM_V4_ID} `).success).toBe(false);
    });

    it("rejects non-string input", () => {
      expect(uuidSchema.safeParse(42).success).toBe(false);
      expect(uuidSchema.safeParse(null).success).toBe(false);
      expect(uuidSchema.safeParse(undefined).success).toBe(false);
    });
  });

  describe("uuidSchemaWithMessage", () => {
    it("reports the caller's wording instead of the generic message", () => {
      const schema = uuidSchemaWithMessage("Invalid organization resource id.");
      const result = schema.safeParse("nope");

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        "Invalid organization resource id.",
      );
    });

    it("accepts exactly the same values as uuidSchema", () => {
      const schema = uuidSchemaWithMessage("custom");

      expect(schema.parse(SEEDED_ID)).toBe(SEEDED_ID);
      expect(schema.safeParse("not-a-uuid").success).toBe(false);
    });
  });

  describe("parseUuid", () => {
    it("returns the identifier unchanged", () => {
      expect(parseUuid(RANDOM_V4_ID)).toBe(RANDOM_V4_ID);
    });

    it("throws a ZodError for a malformed identifier", () => {
      expect(() => parseUuid("not-a-uuid")).toThrow(ZodError);
    });
  });

  describe("asUuid", () => {
    it("returns the value unchanged", () => {
      expect(asUuid(RANDOM_V4_ID)).toBe(RANDOM_V4_ID);
    });

    it("does not validate, because its inputs are already trusted", () => {
      expect(asUuid("generated-id-1")).toBe("generated-id-1");
    });
  });

  describe("asOptionalUuid", () => {
    it("returns the value for a populated column", () => {
      expect(asOptionalUuid(RANDOM_V4_ID)).toBe(RANDOM_V4_ID);
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
    ])("normalizes %s to undefined", (_label, value) => {
      expect(asOptionalUuid(value)).toBeUndefined();
    });

    it("preserves an empty string rather than treating it as absent", () => {
      // Only null and undefined mean "no value"; an empty string is a bug
      // worth surfacing downstream, not something to silently swallow.
      expect(asOptionalUuid("")).toBe("");
    });
  });

  describe("newUuid", () => {
    it("generates an identifier that satisfies isUuid", () => {
      expect(isUuid(newUuid())).toBe(true);
    });

    it("generates distinct values", () => {
      expect(newUuid()).not.toBe(newUuid());
    });
  });
});
