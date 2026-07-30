import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isReservedOrganizationSlug } from "@/features/organizations/organization-slug";

/**
 * Guard against route shadowing.
 *
 * Public organization pages live at /organizations/[reference]. Any *literal*
 * directory added beside that dynamic segment competes with the slug namespace:
 * if someone adds `frontend/src/app/organizations/discover/`, an organization
 * that already owns the slug `discover` becomes unreachable.
 *
 * This test fails when a new literal sibling route is added without also
 * reserving the slug.
 */
describe("organization slug reserved list", () => {
  const organizationsRouteDirectory = join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "frontend",
    "src",
    "app",
    "organizations",
  );

  function readLiteralSiblingSegments(): string[] {
    return (
      readdirSync(organizationsRouteDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        // Dynamic ([id]) and group ((group)) segments do not occupy the slug
        // namespace.
        .filter(
          (entry) =>
            !entry.name.startsWith("[") &&
            !entry.name.startsWith("(") &&
            !entry.name.startsWith("_"),
        )
        .map((entry) => entry.name)
    );
  }

  it("finds the frontend organizations route directory", () => {
    expect(() => readLiteralSiblingSegments()).not.toThrow();
  });

  it("reserves every literal route segment under /organizations", () => {
    const segments = readLiteralSiblingSegments();

    // Sanity check: if this ever hits zero the directory lookup silently broke
    // and the test would pass vacuously.
    expect(segments.length).toBeGreaterThan(0);

    const unreserved = segments.filter(
      (segment) => !isReservedOrganizationSlug(segment),
    );

    expect(unreserved).toEqual([]);
  });
});
