import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedPostingsWorkspace } from "./saved-postings-workspace";

const { useAuthMock, listMock, savedIdsMock, toggleSavedMock, markSavedMock } =
  vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    listMock: vi.fn(),
    savedIdsMock: { current: new Set<string>() },
    toggleSavedMock: vi.fn(),
    markSavedMock: vi.fn(),
  }));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/postings/saved-postings-context", () => ({
  useSavedPostings: () => ({
    status: "ready",
    truncated: false,
    isSaved: (postingId: string) => savedIdsMock.current.has(postingId),
    isPending: () => false,
    toggleSaved: toggleSavedMock,
    markSaved: markSavedMock,
    refresh: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

vi.mock("@/lib/saved-postings/api", () => ({
  savedPostingsApi: {
    list: listMock,
  },
}));

function makePosting(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    name: "Sunny loft",
    description: "Bright loft with a workspace.",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    availabilityStatus: "available",
    savedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function paginated(
  postings: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    postings,
    pagination: {
      page: 1,
      pageSize: 20,
      total: postings.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      ...overrides,
    },
    unavailablePostingIds: [],
  };
}

describe("SavedPostingsWorkspace", () => {
  beforeEach(() => {
    listMock.mockReset();
    toggleSavedMock.mockReset();
    markSavedMock.mockReset();
    savedIdsMock.current = new Set(["posting-1", "posting-2"]);
    useAuthMock.mockReturnValue({ status: "authenticated", session: {} });
  });

  it("prompts anonymous visitors to log in without calling the API", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    render(<SavedPostingsWorkspace />);

    expect(
      screen.getByText("Sign in to see your saved postings"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login?next=/saved",
    );
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders saved postings", async () => {
    listMock.mockResolvedValue(paginated([makePosting()]));

    render(<SavedPostingsWorkspace />);

    expect(await screen.findByText("Sunny loft")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it("shows an empty state with a link to browse", async () => {
    listMock.mockResolvedValue(paginated([]));

    render(<SavedPostingsWorkspace />);

    expect(
      await screen.findByText("You haven't saved any postings yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse postings" }),
    ).toHaveAttribute("href", "/postings");
  });

  it("surfaces a load failure", async () => {
    listMock.mockRejectedValue(new Error("offline"));

    render(<SavedPostingsWorkspace />);

    expect(
      await screen.findByText(/couldn't load your saved postings/i),
    ).toBeInTheDocument();
  });

  it("notes saved postings that are no longer available", async () => {
    listMock.mockResolvedValue({
      ...paginated([makePosting()]),
      unavailablePostingIds: ["posting-9"],
    });

    render(<SavedPostingsWorkspace />);

    expect(
      await screen.findByText(
        "1 saved posting is no longer available and is not shown.",
      ),
    ).toBeInTheDocument();
  });

  it("refetches when the page changes", async () => {
    listMock.mockResolvedValue(
      paginated([makePosting()], {
        total: 40,
        totalPages: 2,
        hasNextPage: true,
      }),
    );
    const user = userEvent.setup();

    render(<SavedPostingsWorkspace />);
    await screen.findByText("Sunny loft");

    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 }),
    );
  });

  // Reviewer feedback on #212: unhearting must be undoable, so the card stays
  // listed until the visitor leaves the page rather than vanishing instantly.
  it("keeps an unhearted posting listed so the change can be undone", async () => {
    listMock.mockResolvedValue(
      paginated([
        makePosting(),
        makePosting({ id: "posting-2", name: "Canal studio" }),
      ]),
    );

    const { rerender } = render(<SavedPostingsWorkspace />);
    await screen.findByText("Sunny loft");

    savedIdsMock.current = new Set(["posting-2"]);
    rerender(<SavedPostingsWorkspace />);

    expect(screen.getByText("Sunny loft")).toBeInTheDocument();
    expect(screen.getByText("Canal studio")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "1 posting is no longer saved. It stays listed until you leave this page, so you can undo it.",
      ),
    ).toBeInTheDocument();
  });

  it("does not refetch the list when a posting is unhearted", async () => {
    listMock.mockResolvedValue(paginated([makePosting()]));

    const { rerender } = render(<SavedPostingsWorkspace />);
    await screen.findByText("Sunny loft");
    expect(listMock).toHaveBeenCalledTimes(1);

    savedIdsMock.current = new Set();
    rerender(<SavedPostingsWorkspace />);

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
  });

  it("seeds the shared saved set so hearts do not flash unsaved", async () => {
    listMock.mockResolvedValue(paginated([makePosting()]));

    render(<SavedPostingsWorkspace />);
    await screen.findByText("Sunny loft");

    expect(markSavedMock).toHaveBeenCalledWith(["posting-1"]);
  });
});
