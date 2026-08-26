import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import { SaveSearchButton } from "./save-search-button";

const { useAuthMock, createMock, showErrorMock, pushMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  createMock: vi.fn(),
  showErrorMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/postings",
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", () => ({
  useErrorToast: () => ({ showError: showErrorMock }),
}));

vi.mock("@/lib/saved-searches/api", () => ({
  savedSearchesApi: {
    create: createMock,
  },
}));

function setLocationSearch(search: string) {
  window.history.replaceState({}, "", `/postings${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ status: "authenticated" });
  createMock.mockResolvedValue({ id: "search-1" });
  setLocationSearch("?q=kayak&family=equipment");
});

describe("SaveSearchButton", () => {
  it("saves the filters from the current browse URL", async () => {
    render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        queryParams: { q: "kayak", family: "equipment" },
      }),
    );
    expect(await screen.findByText(/search saved/i)).toBeInTheDocument();
  });

  it("refuses to save a search with no filters", async () => {
    // An unfiltered search matches every posting, which is a mailing list.
    setLocationSearch("");

    render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    expect(createMock).not.toHaveBeenCalled();
    expect(showErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Add a filter first" }),
    );
  });

  it("sends an anonymous visitor to log in and carries the search back", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous" });

    render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    expect(createMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/postings?q=kayak&family=equipment")}`,
    );
  });

  it("holds a click made while the session is still resolving, then saves", async () => {
    // A returning visitor is "loading" until the refresh round trip settles.
    // Treating that as anonymous would bounce a signed-in user to login.
    useAuthMock.mockReturnValue({ status: "loading" });

    const { rerender } = render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    expect(createMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();

    useAuthMock.mockReturnValue({ status: "authenticated" });
    rerender(<SaveSearchButton />);

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        queryParams: { q: "kayak", family: "equipment" },
      }),
    );
  });

  it("sends a held click to login once the visitor turns out to be anonymous", async () => {
    useAuthMock.mockReturnValue({ status: "loading" });

    const { rerender } = render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    useAuthMock.mockReturnValue({ status: "anonymous" });
    rerender(<SaveSearchButton />);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent("/postings?q=kayak&family=equipment")}`,
      ),
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("treats an already-saved search as success rather than an error", async () => {
    // 409 means the search is saved, which is the outcome the visitor wanted.
    createMock.mockRejectedValue(
      new ApiClientError("Already saved.", {
        code: "CONFLICT",
        status: 409,
        request: {
          method: "POST",
          path: "/postings/saved/searches",
          requestUrl: "http://localhost/postings/saved/searches",
        },
      }),
    );

    render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    expect(await screen.findByText(/search saved/i)).toBeInTheDocument();
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("reports a genuine failure as a toast and stays actionable", async () => {
    createMock.mockRejectedValue(new Error("nope"));

    render(<SaveSearchButton />);

    await userEvent.click(
      screen.getByRole("button", { name: /save this search/i }),
    );

    await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: /save this search/i }),
    ).toBeEnabled();
  });
});
