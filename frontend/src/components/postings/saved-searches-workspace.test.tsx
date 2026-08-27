import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedSearchesWorkspace } from "./saved-searches-workspace";

const {
  useAuthMock,
  listMock,
  updateMock,
  removeMock,
  markSeenMock,
  showErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
  markSeenMock: vi.fn(),
  showErrorMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", () => ({
  useErrorToast: () => ({ showError: showErrorMock }),
}));

vi.mock("@/lib/saved-searches/api", () => ({
  savedSearchesApi: {
    list: listMock,
    update: updateMock,
    remove: removeMock,
    markSeen: markSeenMock,
  },
}));

function makeSearch(overrides: Record<string, unknown> = {}) {
  return {
    id: "search-1",
    name: "Kayaks under $60",
    queryParams: { q: "kayak", family: "equipment", maxDailyPrice: 60 },
    notifyFrequency: "instant" as const,
    newMatchCount: 0,
    lastCheckedAt: null,
    lastNotifiedAt: null,
    invalidated: false,
    createdAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

function makeResult(searches: unknown[], total = searches.length) {
  return {
    searches,
    pagination: {
      page: 1,
      pageSize: 20,
      total,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    limit: 20,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ status: "authenticated" });
  listMock.mockResolvedValue(makeResult([makeSearch()]));
  updateMock.mockImplementation(async (_id: string, patch: object) => ({
    ...makeSearch(),
    ...patch,
  }));
  removeMock.mockResolvedValue(undefined);
  markSeenMock.mockResolvedValue(undefined);
});

describe("SavedSearchesWorkspace", () => {
  it("prompts an anonymous visitor to sign in without calling the API", () => {
    useAuthMock.mockReturnValue({ status: "anonymous" });

    render(<SavedSearchesWorkspace />);

    expect(
      screen.getByText("Sign in to see your saved searches"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login?next=/saved/searches",
    );
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders each saved search with a readable summary of its filters", async () => {
    render(<SavedSearchesWorkspace />);

    expect(
      await screen.findByRole("button", { name: "Kayaks under $60" }),
    ).toBeInTheDocument();
    expect(screen.getByText('"kayak"')).toBeInTheDocument();
    expect(screen.getByText("Equipment")).toBeInTheDocument();
    expect(screen.getByText("under $60/day")).toBeInTheDocument();
  });

  it("links back to the live results for the stored filters", async () => {
    render(<SavedSearchesWorkspace />);

    const link = await screen.findByRole("link", { name: "View results" });

    expect(link).toHaveAttribute("href", expect.stringContaining("q=kayak"));
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("maxDailyPrice=60"),
    );
  });

  it("shows the new-match badge and clears it when the results are opened", async () => {
    listMock.mockResolvedValue(makeResult([makeSearch({ newMatchCount: 3 })]));

    render(<SavedSearchesWorkspace />);

    expect(await screen.findByText("3 new matches")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "View results" }));

    await waitFor(() => expect(markSeenMock).toHaveBeenCalledWith("search-1"));
    expect(screen.queryByText("3 new matches")).not.toBeInTheDocument();
  });

  it("changes how often a search alerts", async () => {
    render(<SavedSearchesWorkspace />);

    const select = await screen.findByLabelText("Alerts");
    await userEvent.selectOptions(select, "daily");

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("search-1", {
        notifyFrequency: "daily",
      }),
    );
  });

  it("rolls the row back and reports a failed frequency change as a toast", async () => {
    // A page-level error would replace the list, leaving no control the
    // visitor could use to retry.
    updateMock.mockRejectedValue(new Error("nope"));

    render(<SavedSearchesWorkspace />);

    const select = await screen.findByLabelText("Alerts");
    await userEvent.selectOptions(select, "off");

    await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
    expect(await screen.findByLabelText("Alerts")).toHaveValue("instant");
  });

  it("renames a search inline", async () => {
    render(<SavedSearchesWorkspace />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Kayaks under $60" }),
    );

    const input = screen.getByLabelText("Search name");
    await userEvent.clear(input);
    await userEvent.type(input, "Weekend kayaks");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("search-1", {
        name: "Weekend kayaks",
      }),
    );
  });

  it("does not write an unchanged name", async () => {
    render(<SavedSearchesWorkspace />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Kayaks under $60" }),
    );
    await userEvent.click(screen.getByLabelText("Search name"));
    await userEvent.tab();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Kayaks under $60" }),
      ).toBeInTheDocument(),
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("removes a deleted search from the list", async () => {
    render(<SavedSearchesWorkspace />);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete saved search Kayaks under $60",
      }),
    );

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("search-1"));
    expect(
      screen.queryByRole("button", { name: "Kayaks under $60" }),
    ).not.toBeInTheDocument();
  });

  it("restores a search when deleting it fails", async () => {
    removeMock.mockRejectedValue(new Error("nope"));

    render(<SavedSearchesWorkspace />);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete saved search Kayaks under $60",
      }),
    );

    await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Kayaks under $60" }),
    ).toBeInTheDocument();
  });

  it("explains an invalidated search and stops it being rescheduled", async () => {
    listMock.mockResolvedValue(makeResult([makeSearch({ invalidated: true })]));

    render(<SavedSearchesWorkspace />);

    expect(
      await screen.findByText(/uses a filter we no longer support/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Alerts")).toBeDisabled();
  });

  it("points a visitor with no saved searches at the browse page", async () => {
    listMock.mockResolvedValue(makeResult([]));

    render(<SavedSearchesWorkspace />);

    expect(
      await screen.findByText("You haven't saved any searches yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse postings" }),
    ).toHaveAttribute("href", "/postings");
  });

  it("reports a failed load in the page-level error state", async () => {
    listMock.mockRejectedValue(new Error("nope"));

    render(<SavedSearchesWorkspace />);

    expect(
      await screen.findByText(/couldn't load your saved searches/i),
    ).toBeInTheDocument();
  });

  it("warns once the per-account limit is reached", async () => {
    listMock.mockResolvedValue(makeResult([makeSearch()], 20));

    render(<SavedSearchesWorkspace />);

    const status = await screen.findByRole("status");

    expect(
      within(status).getByText(/limit of 20 saved searches/),
    ).toBeInTheDocument();
  });
});
