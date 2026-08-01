import { describe, expect, it } from "vitest";
import {
  groupPostingsByOrganization,
  isOrganizationSort,
} from "./group-by-organization";
import type { PublicPostingSummary } from "./search";

function createPosting(
  id: string,
  organization?: PublicPostingSummary["organization"],
): PublicPostingSummary {
  return {
    id,
    name: `Posting ${id}`,
    description: "",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 100 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    availabilityStatus: "available",
    organization,
  };
}

const acme = { id: "org-1", name: "Acme Rentals", slug: "acme-rentals" };
const beltline = { id: "org-2", name: "Beltline Co", slug: "beltline-co" };

describe("isOrganizationSort", () => {
  it("recognizes only the organization sorts", () => {
    expect(isOrganizationSort("organizationAsc")).toBe(true);
    expect(isOrganizationSort("organizationDesc")).toBe(true);
    expect(isOrganizationSort("relevance")).toBe(false);
    expect(isOrganizationSort("nameAsc")).toBe(false);
  });
});

describe("groupPostingsByOrganization", () => {
  it("groups consecutive postings by owning organization", () => {
    const groups = groupPostingsByOrganization([
      createPosting("a", acme),
      createPosting("b", acme),
      createPosting("c", beltline),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.organization?.name).toBe("Acme Rentals");
    expect(groups[0]?.postings.map((posting) => posting.id)).toEqual([
      "a",
      "b",
    ]);
    expect(groups[1]?.postings.map((posting) => posting.id)).toEqual(["c"]);
  });

  it("preserves server order instead of re-sorting", () => {
    // The server already applied the ordering and its stable tiebreak, so a
    // non-adjacent repeat must stay non-adjacent rather than being merged.
    const groups = groupPostingsByOrganization([
      createPosting("a", beltline),
      createPosting("b", acme),
      createPosting("c", beltline),
    ]);

    expect(groups.map((group) => group.organization?.name)).toEqual([
      "Beltline Co",
      "Acme Rentals",
      "Beltline Co",
    ]);
  });

  it("groups postings without an organization under a single key", () => {
    const groups = groupPostingsByOrganization([
      createPosting("a"),
      createPosting("b"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.organization).toBeUndefined();
    expect(groups[0]?.postings).toHaveLength(2);
  });

  it("returns no groups for an empty page", () => {
    expect(groupPostingsByOrganization([])).toEqual([]);
  });
});
