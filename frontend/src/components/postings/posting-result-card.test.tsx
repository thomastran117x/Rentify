import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostingResultCard } from "./posting-result-card";
import type { PublicPostingSummary } from "@/lib/postings/search";
import { buildPostingFacetHrefs } from "@/lib/postings/facet-href";

function makePosting(
  overrides: Partial<PublicPostingSummary> = {},
): PublicPostingSummary {
  return {
    id: "posting-1",
    name: "Sunny loft",
    description: "Bright loft with a workspace.",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: ["loft"],
    availabilityStatus: "available",
    organization: { id: "org-1", name: "Northside Rentals", slug: "northside" },
    ...overrides,
  };
}

describe("PostingResultCard", () => {
  it("renders the posting summary and a link to the detail page", () => {
    render(<PostingResultCard posting={makePosting()} />);

    expect(screen.getByText("Sunny loft")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/postings/posting-1",
    );
  });

  it("renders the actions slot", () => {
    render(
      <PostingResultCard
        posting={makePosting()}
        actions={<button type="button">Save Sunny loft</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Save Sunny loft" }),
    ).toBeInTheDocument();
  });

  it("renders the organization filter chip when a href builder is supplied", () => {
    render(
      <PostingResultCard
        posting={makePosting()}
        buildOrganizationFilterHref={(organizationId) =>
          `/postings?organizationId=${organizationId}`
        }
      />,
    );

    expect(
      screen.getByRole("link", { name: "Only this organization" }),
    ).toHaveAttribute("href", "/postings?organizationId=org-1");
  });

  it("links tags, category, and location to search filters", () => {
    render(
      <PostingResultCard
        posting={makePosting({ tags: ["loft", "wifi"] })}
        facetHrefs={buildPostingFacetHrefs(
          { sort: "relevance", pageSize: 20, tags: ["loft"] },
          makePosting(),
        )}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Filter by tag wifi" }),
    ).toHaveAttribute(
      "href",
      "/postings?sort=relevance&page=1&pageSize=20&tags=loft&tags=wifi",
    );
    // An applied tag is shown as active and clicking it removes the filter.
    expect(
      screen.getByRole("link", { name: "Remove tag filter loft" }),
    ).toHaveAttribute("href", "/postings?sort=relevance&page=1&pageSize=20");
    expect(
      screen.getByRole("link", { name: "Filter by category Place" }),
    ).toHaveAttribute("href", expect.stringContaining("family=place"));
    expect(
      screen.getByRole("link", { name: "Filter by category Workspace" }),
    ).toHaveAttribute("href", expect.stringContaining("subtype=workspace"));
    expect(
      screen.getByRole("link", { name: "Filter by city Toronto" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("city=Toronto&region=Ontario&country=Canada"),
    );
  });

  it("renders tags, category, and location as text without facet hrefs", () => {
    render(<PostingResultCard posting={makePosting()} />);

    expect(screen.getByText("loft")).toBeInTheDocument();
    expect(screen.getByText("Toronto")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Filter by/ }),
    ).not.toBeInTheDocument();
  });

  it("omits the organization filter chip without a href builder", () => {
    render(<PostingResultCard posting={makePosting()} />);

    expect(
      screen.queryByRole("link", { name: "Only this organization" }),
    ).not.toBeInTheDocument();
    // The organization is still credited, just not filterable.
    expect(screen.getByText("Northside Rentals")).toBeInTheDocument();
  });
});
