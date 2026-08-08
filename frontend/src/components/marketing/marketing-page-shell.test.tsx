import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketingPageShell } from "./marketing-page-shell";

vi.mock("@/components/marketing/marketing-hero-search", () => ({
  MarketingHeroSearch: () => <div data-testid="hero-search" />,
}));

describe("MarketingPageShell", () => {
  it("renders default calls to action without optional content", () => {
    render(
      <MarketingPageShell
        eyebrow="Rentify"
        title="Find your next rental"
        description="Search with confidence."
        accent="rgba(0, 0, 0, 0.2)"
      >
        <p>Page content</p>
      </MarketingPageShell>,
    );

    expect(screen.getByText("Rentify")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Find your next rental" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("hero-search")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Talk to our team" }),
    ).toHaveAttribute("href", "/contact");
    expect(
      screen.getByRole("link", { name: "Browse rentals" }),
    ).toHaveAttribute("href", "/postings");
    expect(screen.queryByText("Quick links:")).not.toBeInTheDocument();
  });

  it("renders supplied calls to action, links, stats, and aside", () => {
    render(
      <MarketingPageShell
        eyebrow="Owners"
        title="Make listings clearer"
        description="Keep information aligned."
        accent="rgb(1, 2, 3)"
        ctaLabel="Create a posting"
        ctaHref="/postings/create"
        secondaryCtaLabel="Explore help"
        secondaryCtaHref="/faq"
        quickLinks={[{ href: "/contact", label: "Contact support" }]}
        stats={[{ label: "Support days", value: "7" }]}
        aside={<p>Useful context</p>}
      >
        <p>Owner content</p>
      </MarketingPageShell>,
    );

    expect(
      screen.getByRole("link", { name: "Create a posting" }),
    ).toHaveAttribute("href", "/postings/create");
    expect(screen.getByRole("link", { name: "Explore help" })).toHaveAttribute(
      "href",
      "/faq",
    );
    expect(
      screen.getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", "/contact");
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Support days")).toBeInTheDocument();
    expect(screen.getByText("Useful context")).toBeInTheDocument();
  });
});
