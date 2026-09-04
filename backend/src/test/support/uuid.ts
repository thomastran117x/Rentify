import { asUuid, type Uuid } from "@/configuration/validation/uuid";

export { asUuid, type Uuid };

/**
 * Builds a deterministic, readable identifier for tests.
 *
 * Mirrors `createFixtureId` in the seeds so a test id looks like the ids the
 * application actually stores, and — unlike a bare `"posting-1"` — survives the
 * identifier validation the request boundary now performs.
 */
export function testUuid(namespace: number, index: number): Uuid {
  const namespacePart = namespace.toString().padStart(4, "0").slice(-4);
  const indexPart = index.toString().padStart(12, "0").slice(-12);
  return asUuid(`00000000-0000-0000-${namespacePart}-${indexPart}`);
}
