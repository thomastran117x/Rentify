import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecentlyViewedRow } from "./recently-viewed-row";
import type { RecentlyViewedPostingSummary } from "@/lib/recently-viewed/api";

const { useRecentlyViewedMock } = vi.hoisted(() => ({
  useRecentlyViewedMock: vi.fn(),
}));

vi.mock("./recently-viewed-context", () => ({
  useRecentlyViewed: useRecentlyViewedMock,
}));

function makePosting(id: string): RecentlyViewedPostingSummary {
  return {
    id,
    name: `Posting ${id}`,
    description: "A place.",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    availabilityStatus: "available",
    viewedAt: "2026-09-08T12:00:00.000Z",
  };
}

function mockState(
  overrides: Partial<{
    status: string;
    postings: RecentlyViewedPostingSummary[];
  }> = {},
) {
  useRecentlyViewedMock.mockReturnValue({
    status: "ready",
    postings: [],
    trackingEnabled: true,
    recordView: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    setTrackingEnabled: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  });
}

describe("RecentlyViewedRow", () => {
  // The whole point of the component: on the home and browse pages it must add
  // nothing at all until there is something real to show, so a first-time
  // visitor's layout is untouched and nothing shifts after hydration.
  it("renders nothing while still loading", () => {
    mockState({ status: "loading" });

    const { container } = render(<RecentlyViewedRow surface="home" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on error", () => {
    mockState({ status: "error" });

    const { container } = render(<RecentlyViewedRow surface="home" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no history", () => {
    mockState({ status: "ready", postings: [] });

    const { container } = render(<RecentlyViewedRow surface="browse" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a tile per posting once there is history", () => {
    mockState({
      status: "ready",
      postings: [makePosting("a"), makePosting("b")],
    });

    render(<RecentlyViewedRow surface="home" />);

    expect(
      screen.getByRole("heading", { name: /Recently viewed/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/saved/recent",
    );
  });

  it("never shows more than the limit", () => {
    mockState({
      status: "ready",
      postings: ["a", "b", "c", "d"].map(makePosting),
    });

    render(<RecentlyViewedRow surface="browse" limit={2} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  // Remove controls live on /saved/recent only: a dense strip with a
  // destructive control on every tile is a mis-click factory.
  it("offers no remove control on a strip", () => {
    mockState({ status: "ready", postings: [makePosting("a")] });

    render(<RecentlyViewedRow surface="home" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
