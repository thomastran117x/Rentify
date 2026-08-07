import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SavedPostingsProvider,
  useSavedPostings,
} from "./saved-postings-context";

const {
  pushMock,
  useAuthMock,
  showErrorMock,
  saveMock,
  unsaveMock,
  listIdsMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useAuthMock: vi.fn(),
  showErrorMock: vi.fn(),
  saveMock: vi.fn(),
  unsaveMock: vi.fn(),
  listIdsMock: vi.fn(),
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

vi.mock("@/lib/saved-postings/api", () => ({
  savedPostingsApi: {
    save: saveMock,
    unsave: unsaveMock,
    listIds: listIdsMock,
  },
}));

function Consumer({ postingIds = ["posting-1"] }: { postingIds?: string[] }) {
  const { isSaved, isPending, status, toggleSaved } = useSavedPostings();

  return (
    <div>
      <span data-testid="status">{status}</span>
      {postingIds.map((postingId) => (
        <button
          key={postingId}
          type="button"
          onClick={() => void toggleSaved(postingId)}
          data-testid={postingId}
          data-saved={isSaved(postingId) ? "yes" : "no"}
          data-pending={isPending(postingId) ? "yes" : "no"}
        >
          {postingId}
        </button>
      ))}
    </div>
  );
}

function renderProvider(ui: React.ReactNode) {
  return render(<SavedPostingsProvider>{ui}</SavedPostingsProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe("SavedPostingsProvider", () => {
  beforeEach(() => {
    pushMock.mockReset();
    showErrorMock.mockReset();
    saveMock.mockReset();
    unsaveMock.mockReset();
    listIdsMock.mockReset();
    listIdsMock.mockResolvedValue({ postingIds: [], truncated: false });
    useAuthMock.mockReturnValue({ status: "authenticated", session: {} });
  });

  it("never requests saved identifiers for anonymous visitors", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });

    renderProvider(<Consumer />);

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("anonymous"),
    );
    expect(listIdsMock).not.toHaveBeenCalled();
  });

  it("sends anonymous visitors to the login page instead of saving", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await user.click(screen.getByTestId("posting-1"));

    expect(pushMock).toHaveBeenCalledWith("/login?next=%2Fpostings");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("loads the identifier set once even with several consumers mounted", async () => {
    listIdsMock.mockResolvedValue({
      postingIds: ["posting-1"],
      truncated: false,
    });

    renderProvider(
      <>
        <Consumer postingIds={["posting-1"]} />
        <Consumer postingIds={["posting-2"]} />
      </>,
    );

    await waitFor(() => expect(listIdsMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "yes",
      ),
    );
  });

  it("flips saved state before the request resolves", async () => {
    const pending = deferred<{ saved: boolean }>();
    saveMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await waitFor(() => expect(listIdsMock).toHaveBeenCalled());

    await user.click(screen.getByTestId("posting-1"));

    expect(screen.getByTestId("posting-1")).toHaveAttribute(
      "data-saved",
      "yes",
    );
    expect(screen.getByTestId("posting-1")).toHaveAttribute(
      "data-pending",
      "yes",
    );

    pending.resolve({ saved: true });
    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-pending",
        "no",
      ),
    );
  });

  it("rolls back and reports an error when saving fails", async () => {
    saveMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await waitFor(() => expect(listIdsMock).toHaveBeenCalled());

    await user.click(screen.getByTestId("posting-1"));

    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "no",
      ),
    );
    expect(showErrorMock).toHaveBeenCalledTimes(1);
  });

  // A whole-set snapshot rollback would revert the unrelated posting too.
  it("rolls back only the posting whose request failed", async () => {
    const failing = deferred<{ saved: boolean }>();
    const succeeding = deferred<{ saved: boolean }>();
    saveMock.mockImplementation((postingId: string) =>
      postingId === "posting-1" ? failing.promise : succeeding.promise,
    );
    const user = userEvent.setup();

    renderProvider(<Consumer postingIds={["posting-1", "posting-2"]} />);
    await waitFor(() => expect(listIdsMock).toHaveBeenCalled());

    await user.click(screen.getByTestId("posting-1"));
    await user.click(screen.getByTestId("posting-2"));

    succeeding.resolve({ saved: true });
    failing.reject(new Error("network down"));

    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "no",
      ),
    );
    expect(screen.getByTestId("posting-2")).toHaveAttribute(
      "data-saved",
      "yes",
    );
  });

  it("reconciles to the server state when it disagrees with the optimistic flip", async () => {
    saveMock.mockResolvedValue({
      postingId: "posting-1",
      saved: false,
      savedAt: null,
    });
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await waitFor(() => expect(listIdsMock).toHaveBeenCalled());

    await user.click(screen.getByTestId("posting-1"));

    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "no",
      ),
    );
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("unsaves a posting that is already saved", async () => {
    listIdsMock.mockResolvedValue({
      postingIds: ["posting-1"],
      truncated: false,
    });
    unsaveMock.mockResolvedValue({
      postingId: "posting-1",
      saved: false,
      savedAt: null,
    });
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "yes",
      ),
    );

    await user.click(screen.getByTestId("posting-1"));

    expect(unsaveMock).toHaveBeenCalledWith("posting-1");
    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "no",
      ),
    );
  });

  it("degrades to an error status without throwing when the fetch fails", async () => {
    listIdsMock.mockRejectedValue(new Error("offline"));

    renderProvider(<Consumer />);

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("error"),
    );
    expect(screen.getByTestId("posting-1")).toHaveAttribute("data-saved", "no");
  });

  it("marks identifiers as saved without a request", async () => {
    function Seeder() {
      const { markSaved } = useSavedPostings();

      return (
        <button type="button" onClick={() => markSaved(["posting-1"])}>
          seed
        </button>
      );
    }

    const user = userEvent.setup();
    renderProvider(
      <>
        <Seeder />
        <Consumer />
      </>,
    );
    await waitFor(() => expect(listIdsMock).toHaveBeenCalled());
    expect(screen.getByTestId("posting-1")).toHaveAttribute("data-saved", "no");

    await user.click(screen.getByRole("button", { name: "seed" }));

    expect(screen.getByTestId("posting-1")).toHaveAttribute(
      "data-saved",
      "yes",
    );
    expect(saveMock).not.toHaveBeenCalled();
  });

  // The identifier request is a snapshot taken when it was issued. A toggle
  // that lands while it is in flight must survive its arrival, or the heart
  // silently reverts and stays wrong until the next page load.
  it("does not let a late identifier snapshot clobber a toggle", async () => {
    const pendingIds = deferred<{ postingIds: string[]; truncated: boolean }>();
    listIdsMock.mockReturnValue(pendingIds.promise);
    saveMock.mockResolvedValue({
      postingId: "posting-1",
      saved: true,
      savedAt: "2026-08-01T12:00:00.000Z",
    });
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await waitFor(() => expect(listIdsMock).toHaveBeenCalled());

    // Saved before the snapshot resolves.
    await user.click(screen.getByTestId("posting-1"));
    await waitFor(() =>
      expect(screen.getByTestId("posting-1")).toHaveAttribute(
        "data-saved",
        "yes",
      ),
    );

    // The snapshot predates the save and does not contain the posting.
    pendingIds.resolve({ postingIds: [], truncated: false });

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("ready"),
    );
    expect(screen.getByTestId("posting-1")).toHaveAttribute(
      "data-saved",
      "yes",
    );
  });

  // Review finding: a returning visitor is "loading" until the refresh round
  // trip settles, but the server-rendered cards are already clickable.
  describe("while the auth status is still settling", () => {
    it("does not bounce a signed-in visitor to the login page", async () => {
      useAuthMock.mockReturnValue({ status: "loading", session: null });
      const user = userEvent.setup();

      const { rerender } = renderProvider(<Consumer />);
      await user.click(screen.getByTestId("posting-1"));

      expect(pushMock).not.toHaveBeenCalled();

      // The click is replayed as a save once the session is known.
      saveMock.mockResolvedValue({
        postingId: "posting-1",
        saved: true,
        savedAt: "2026-08-01T12:00:00.000Z",
      });
      useAuthMock.mockReturnValue({ status: "authenticated", session: {} });
      rerender(
        <SavedPostingsProvider>
          <Consumer />
        </SavedPostingsProvider>,
      );

      await waitFor(() => expect(saveMock).toHaveBeenCalledWith("posting-1"));
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("replays the click to the login page once the visitor is known to be anonymous", async () => {
      useAuthMock.mockReturnValue({ status: "loading", session: null });
      const user = userEvent.setup();

      const { rerender } = renderProvider(<Consumer />);
      await user.click(screen.getByTestId("posting-1"));
      expect(pushMock).not.toHaveBeenCalled();

      useAuthMock.mockReturnValue({ status: "anonymous", session: null });
      rerender(
        <SavedPostingsProvider>
          <Consumer />
        </SavedPostingsProvider>,
      );

      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      expect(saveMock).not.toHaveBeenCalled();
    });
  });

  // Review finding: usePathname drops the query string, which would lose the
  // visitor's search on the way back from signing in.
  it("keeps the query string when sending an anonymous visitor to log in", async () => {
    useAuthMock.mockReturnValue({ status: "anonymous", session: null });
    window.history.replaceState({}, "", "/postings?q=loft&family=place");
    const user = userEvent.setup();

    renderProvider(<Consumer />);
    await user.click(screen.getByTestId("posting-1"));

    expect(pushMock).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent("/postings?q=loft&family=place")}`,
    );

    window.history.replaceState({}, "", "/");
  });

  // Review finding: the saved page mounts its hearts only after the list
  // arrives, so a count-based dependency aborted and re-issued the request.
  it("does not re-issue the identifier request when more hearts mount later", async () => {
    function LateConsumer() {
      const [mounted, setMounted] = useState(false);

      return (
        <>
          <Consumer />
          <button type="button" onClick={() => setMounted(true)}>
            mount more
          </button>
          {mounted ? <Consumer postingIds={["posting-2"]} /> : null}
        </>
      );
    }

    const user = userEvent.setup();
    renderProvider(<LateConsumer />);
    await waitFor(() => expect(listIdsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "mount more" }));

    await waitFor(() =>
      expect(screen.getByTestId("posting-2")).toBeInTheDocument(),
    );
    expect(listIdsMock).toHaveBeenCalledTimes(1);
  });
});
