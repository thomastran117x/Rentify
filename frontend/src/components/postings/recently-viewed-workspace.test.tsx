import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecentlyViewedWorkspace } from "./recently-viewed-workspace";
import type { RecentlyViewedPostingSummary } from "@/lib/recently-viewed/api";

const { useAuthMock, useRecentlyViewedMock, removeMock, clearMock } =
  vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    useRecentlyViewedMock: vi.fn(),
    removeMock: vi.fn(),
    clearMock: vi.fn(),
  }));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("./recently-viewed-context", () => ({
  useRecentlyViewed: useRecentlyViewedMock,
}));

function makePosting(
  id: string,
  viewedAt = new Date().toISOString(),
): RecentlyViewedPostingSummary {
  return {
    id,
    name: `Posting ${id}`,
    description: "A place.",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    availabilityStatus: "available",
    viewedAt,
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
    remove: removeMock,
    clear: clearMock,
    setTrackingEnabled: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  });
}

describe("RecentlyViewedWorkspace", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ status: "authenticated", session: null });
    removeMock.mockResolvedValue(undefined);
    clearMock.mockResolvedValue(undefined);
  });

  it("shows a skeleton while the session is resolving", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });
    mockState({ status: "loading" });

    render(<RecentlyViewedWorkspace />);

    expect(
      screen.queryByRole("heading", { name: "Recently viewed" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "" })).not.toBeInTheDocument();
  });

  it("shows the empty state with a way to start browsing", () => {
    mockState({ status: "ready", postings: [] });

    render(<RecentlyViewedWorkspace />);

    expect(
      screen.getByText("You haven't viewed any postings yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse postings" }),
    ).toHaveAttribute("href", "/postings");
    // Nothing to clear, so the control is not offered.
    expect(
      screen.queryByRole("button", { name: "Clear history" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error state", () => {
    mockState({ status: "error" });

    render(<RecentlyViewedWorkspace />);

    expect(
      screen.getByText(/couldn't load your recently viewed/i),
    ).toBeInTheDocument();
  });

  it("renders a tile and a remove control per posting", () => {
    mockState({ postings: [makePosting("a"), makePosting("b")] });

    render(<RecentlyViewedWorkspace />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: "Remove Posting a from recently viewed",
      }),
    ).toBeInTheDocument();
  });

  it("removes one posting", async () => {
    mockState({ postings: [makePosting("a")] });

    render(<RecentlyViewedWorkspace />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Posting a from recently viewed",
      }),
    );

    expect(removeMock).toHaveBeenCalledWith("a");
  });

  // Two-step rather than a modal: the repo has no shared confirm dialog, and a
  // single click should not be able to wipe a history.
  it("asks for confirmation before clearing", async () => {
    mockState({ postings: [makePosting("a")] });

    render(<RecentlyViewedWorkspace />);

    await userEvent.click(
      screen.getByRole("button", { name: "Clear history" }),
    );

    expect(clearMock).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Yes, clear history" }),
    );

    await waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1));
  });

  it("tells a signed-out visitor their history is local, without a sign-in wall", () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });
    mockState({ postings: [makePosting("a")] });

    render(<RecentlyViewedWorkspace />);

    // The list is still shown -- this is not a gate.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/kept in this browser only/i)).toBeInTheDocument();
    expect(
      screen.getByText(/carry this history across your devices/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?next=/saved/recent",
    );
  });

  it("omits the local-history notice when signed in", () => {
    mockState({ postings: [makePosting("a")] });

    render(<RecentlyViewedWorkspace />);

    expect(
      screen.queryByText(/kept in this browser only/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/follow you between devices/i)).toBeInTheDocument();
  });

  describe("viewed-at wording", () => {
    it("says today for a view from moments ago", () => {
      mockState({ postings: [makePosting("a", new Date().toISOString())] });

      render(<RecentlyViewedWorkspace />);

      expect(screen.getByText("Viewed today")).toBeInTheDocument();
    });

    it("says yesterday", () => {
      mockState({
        postings: [
          makePosting("a", new Date(Date.now() - 86_400_000).toISOString()),
        ],
      });

      render(<RecentlyViewedWorkspace />);

      expect(screen.getByText("Viewed yesterday")).toBeInTheDocument();
    });

    it("counts days inside the first month", () => {
      mockState({
        postings: [
          makePosting("a", new Date(Date.now() - 5 * 86_400_000).toISOString()),
        ],
      });

      render(<RecentlyViewedWorkspace />);

      expect(screen.getByText("Viewed 5 days ago")).toBeInTheDocument();
    });

    it("falls back to a date beyond a month", () => {
      mockState({
        postings: [
          makePosting(
            "a",
            new Date(Date.now() - 60 * 86_400_000).toISOString(),
          ),
        ],
      });

      render(<RecentlyViewedWorkspace />);

      expect(screen.getByText(/^Viewed on /)).toBeInTheDocument();
    });

    it("renders no footnote for an unparseable timestamp", () => {
      mockState({ postings: [makePosting("a", "not-a-date")] });

      render(<RecentlyViewedWorkspace />);

      expect(screen.queryByText(/^Viewed/)).not.toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    it("shows only the first page of cards, with a control to reveal more", () => {
      const postings = Array.from({ length: 30 }, (_unused, index) =>
        makePosting(`posting-${index}`),
      );
      mockState({ postings });

      render(<RecentlyViewedWorkspace />);

      expect(screen.getAllByRole("listitem")).toHaveLength(24);
      expect(
        screen.getByRole("button", { name: "Show more" }),
      ).toBeInTheDocument();
    });

    it("reveals the rest on click, without a new fetch", async () => {
      const postings = Array.from({ length: 30 }, (_unused, index) =>
        makePosting(`posting-${index}`),
      );
      mockState({ postings });

      render(<RecentlyViewedWorkspace />);

      await userEvent.click(screen.getByRole("button", { name: "Show more" }));

      expect(screen.getAllByRole("listitem")).toHaveLength(30);
      expect(
        screen.queryByRole("button", { name: "Show more" }),
      ).not.toBeInTheDocument();
    });

    it("omits the control when everything already fits on one page", () => {
      mockState({ postings: [makePosting("a"), makePosting("b")] });

      render(<RecentlyViewedWorkspace />);

      expect(
        screen.queryByRole("button", { name: "Show more" }),
      ).not.toBeInTheDocument();
    });
  });
});
