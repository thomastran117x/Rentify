import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostingCompactCard } from "./posting-compact-card";
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

describe("PostingCompactCard", () => {
  it("links the whole tile to the posting", () => {
    render(<PostingCompactCard posting={makePosting()} />);

    expect(screen.getByRole("link", { name: "Sunny loft" })).toHaveAttribute(
      "href",
      "/postings/posting-1",
    );
  });

  it("shows the nightly price and the city", () => {
    render(<PostingCompactCard posting={makePosting()} />);

    expect(screen.getByText(/Toronto, Ontario/)).toBeInTheDocument();
    expect(screen.getByText(/\/ day/)).toBeInTheDocument();
  });

  it("renders a preview image when one is usable", () => {
    render(
      <PostingCompactCard
        posting={makePosting({
          primaryThumbnailUrl: "https://cdn.example.test/thumb.jpg",
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Sunny loft" })).toHaveAttribute(
      "src",
      "https://cdn.example.test/thumb.jpg",
    );
  });

  it("falls back to a placeholder without an image", () => {
    render(<PostingCompactCard posting={makePosting()} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No Image")).toBeInTheDocument();
  });

  it("renders the footnote", () => {
    render(
      <PostingCompactCard
        posting={makePosting()}
        footnote="Viewed yesterday"
      />,
    );

    expect(screen.getByText("Viewed yesterday")).toBeInTheDocument();
  });

  it("renders the actions slot", () => {
    render(
      <PostingCompactCard
        posting={makePosting()}
        actions={<button type="button">Remove Sunny loft</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Sunny loft" }),
    ).toBeInTheDocument();
  });

  it("omits the actions container when no actions are given", () => {
    render(<PostingCompactCard posting={makePosting()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
