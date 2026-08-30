import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Entity identifier shape: 8-4-4-4-12 hexadecimal, case-insensitive.
 *
 * Deliberately NOT RFC 4122. Identifiers are stored as `VarChar(36)` and are
 * not required to carry version and variant bits, because the deterministic
 * seed ids built by `createFixtureId` (`00000000-0000-0000-1040-000000000016`
 * and friends, see seeds/types.ts) use a zero version nibble. `z.uuid()` and
 * OpenAPI's `format: uuid` assert those bits and reject every seeded id, which
 * is why this module is built on `z.guid()` instead.
 *
 * Kept as a source string so openapi/spec.ts can emit it verbatim as a JSON
 * Schema `pattern` and stay in step with what the API actually accepts.
 */
export const UUID_PATTERN_SOURCE =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

export const UUID_PATTERN = new RegExp(UUID_PATTERN_SOURCE);

/**
 * {@link uuidSchema} with caller-specific wording, for endpoints that already
 * return a message more precise than the generic one.
 */
export function uuidSchemaWithMessage(message: string) {
  return z.guid(message).brand<"Uuid">();
}

/**
 * Validating schema for identifiers arriving from untrusted input.
 *
 * `.brand()` is a compile-time-only marker; Zod returns the same schema
 * instance, so this costs nothing at runtime. Note that `z.guid()` does not
 * trim: use `z.string().trim().pipe(uuidSchema)` where padded input is
 * currently accepted.
 */
export const uuidSchema = uuidSchemaWithMessage("Invalid identifier.");

/**
 * A `VarChar(36)` entity identifier.
 *
 * Structurally a `string` at runtime and assignable to `string`, so it flows
 * into Prisma filters, template literals, and `Record<string, …>` keys without
 * ceremony. The reverse does not hold: a plain `string` only becomes a `Uuid`
 * by way of {@link uuidSchema}, {@link parseUuid}, or an explicit
 * {@link asUuid}, which is the point.
 */
export type Uuid = z.infer<typeof uuidSchema>;

export function isUuid(value: string): value is Uuid {
  return UUID_PATTERN.test(value);
}

/**
 * Brands a value that is already known to be an identifier, without checking.
 *
 * For trusted sources only: rows read back from the database, seed fixtures,
 * and claims from a signature-verified token. Untrusted input belongs in
 * {@link parseUuid} or {@link uuidSchema}.
 */
export function asUuid(value: string): Uuid {
  return value as Uuid;
}

/** Narrows a nullable identifier column to an optional branded identifier. */
export function asOptionalUuid(
  value: string | null | undefined,
): Uuid | undefined {
  return value === null || value === undefined ? undefined : (value as Uuid);
}

/** Parses untrusted input into an identifier. Throws `ZodError` on failure. */
export function parseUuid(value: unknown): Uuid {
  return uuidSchema.parse(value);
}

/**
 * Generates a new entity identifier.
 *
 * Deliberately performs no validation of its own. Several repository unit
 * tests mock `node:crypto` to return fixed non-identifier strings
 * (`"generated-id-1"`), and validating here would throw in those tests without
 * protecting anything real.
 */
export function newUuid(): Uuid {
  return randomUUID() as Uuid;
}
