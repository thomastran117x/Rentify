import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostingResultCard } from "./posting-result-card";
import type { PublicPostingSummary } from "@/lib/postings/search";

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

  it("omits the organization filter chip without a href builder", () => {
    render(<PostingResultCard posting={makePosting()} />);

    expect(
      screen.queryByRole("link", { name: "Only this organization" }),
    ).not.toBeInTheDocument();
    // The organization is still credited, just not filterable.
    expect(screen.getByText("Northside Rentals")).toBeInTheDocument();
  });
});
