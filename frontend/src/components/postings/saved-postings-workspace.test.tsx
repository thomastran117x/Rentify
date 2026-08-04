import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedPostingsWorkspace } from "./saved-postings-workspace";

const {
  useAuthMock,
  listMock,
  savedIdsMock,
  toggleSavedMock,
  markSavedMock,
  unsaveMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listMock: vi.fn(),
  savedIdsMock: { current: new Set<string>() },
  toggleSavedMock: vi.fn(),
  markSavedMock: vi.fn(),
  unsaveMock: vi.fn(),
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
    unsave: unsaveMock,
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
    unavailablePostings: [],
  };
}

describe("SavedPostingsWorkspace", () => {
  beforeEach(() => {
    listMock.mockReset();
    toggleSavedMock.mockReset();
    markSavedMock.mockReset();
    unsaveMock.mockReset();
    unsaveMock.mockResolvedValue({
      postingId: "posting-9",
      saved: false,
      savedAt: null,
    });
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

  it("names a paused posting and says it may come back", async () => {
    listMock.mockResolvedValue({
      ...paginated([makePosting()]),
      unavailablePostings: [
        {
          postingId: "posting-9",
          name: "Harbourside Studio",
          reason: "paused",
          savedAt: "2026-07-20T09:30:00.000Z",
        },
      ],
    });

    render(<SavedPostingsWorkspace />);

    expect(
      await screen.findByText(
        "Harbourside Studio is unavailable to view right now. The host has paused it, so it may come back.",
      ),
    ).toBeInTheDocument();
  });

  it("names a removed posting and says it is gone", async () => {
    listMock.mockResolvedValue({
      ...paginated([makePosting()]),
      unavailablePostings: [
        {
          postingId: "posting-9",
          name: "Harbourside Studio",
          reason: "unavailable",
          savedAt: "2026-07-20T09:30:00.000Z",
        },
      ],
    });

    render(<SavedPostingsWorkspace />);

    expect(
      await screen.findByText(
        "Harbourside Studio is no longer available to view. It has been removed from the marketplace.",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to generic wording when the posting record is gone", async () => {
    listMock.mockResolvedValue({
      ...paginated([]),
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      unavailablePostings: [
        {
          postingId: "posting-9",
          name: null,
          reason: "unavailable",
          savedAt: "2026-07-20T09:30:00.000Z",
        },
      ],
    });

    render(<SavedPostingsWorkspace />);

    expect(
      await screen.findByText(
        "This posting is no longer available to view. It has been removed from the marketplace.",
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

  // Codex review on #212: a page whose saved rows have all become unavailable
  // returns no postings but a positive total, and must not be mistaken for an
  // empty wishlist.
  describe("when every saved row on the page is unavailable", () => {
    function unavailableOnlyPage() {
      return {
        postings: [],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        unavailablePostings: [
          {
            postingId: "posting-8",
            name: "Harbourside Studio",
            reason: "paused" as const,
            savedAt: "2026-07-20T09:30:00.000Z",
          },
          {
            postingId: "posting-9",
            name: "Old Mill Loft",
            reason: "unavailable" as const,
            savedAt: "2026-07-21T09:30:00.000Z",
          },
        ],
      };
    }

    it("does not claim the wishlist is empty", async () => {
      listMock.mockResolvedValue(unavailableOnlyPage());

      render(<SavedPostingsWorkspace />);

      expect(await screen.findByText(/Harbourside Studio/)).toBeInTheDocument();
      expect(screen.getByText(/Old Mill Loft/)).toBeInTheDocument();
      expect(
        screen.queryByText("You haven't saved any postings yet"),
      ).not.toBeInTheDocument();
    });

    it("removes a single unavailable posting on request", async () => {
      listMock.mockResolvedValue(unavailableOnlyPage());
      const user = userEvent.setup();

      render(<SavedPostingsWorkspace />);
      const removeButton = await screen.findByRole("button", {
        name: "Remove Harbourside Studio from saved postings",
      });

      await user.click(removeButton);

      await waitFor(() => expect(unsaveMock).toHaveBeenCalledWith("posting-8"));
      // The other one is left alone: removal is per posting, never a sweep.
      expect(unsaveMock).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    });

    it("still shows the empty state when nothing is saved at all", async () => {
      listMock.mockResolvedValue(paginated([]));

      render(<SavedPostingsWorkspace />);

      expect(
        await screen.findByText("You haven't saved any postings yet"),
      ).toBeInTheDocument();
    });
  });
});
