import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecentlyViewedProvider,
  useRecentlyViewed,
} from "./recently-viewed-context";
import {
  adoptForAccount,
  recordView as recordLocalView,
  resetCacheForTests,
  setTrackingEnabled,
} from "@/lib/recently-viewed/storage";

const STORAGE_KEY = "rentify.recently-viewed.v2";

const {
  useAuthMock,
  showErrorMock,
  batchPublicMock,
  listMock,
  syncMock,
  clearMock,
  removeMock,
  recordViewMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  showErrorMock: vi.fn(),
  batchPublicMock: vi.fn(),
  listMock: vi.fn(),
  syncMock: vi.fn(),
  clearMock: vi.fn(),
  removeMock: vi.fn(),
  recordViewMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", () => ({
  useErrorToast: () => ({ showError: showErrorMock }),
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: { batchPublic: batchPublicMock },
}));

vi.mock("@/lib/recently-viewed/api", () => ({
  // Mirrors the real constant's value; the module is mocked wholesale so it
  // has to be re-declared here for the provider's import to resolve.
  RECENTLY_VIEWED_SYNC_MAX: 50,
  recentlyViewedApi: {
    list: listMock,
    sync: syncMock,
    clear: clearMock,
    remove: removeMock,
    recordView: recordViewMock,
  },
}));

function makePosting(id: string, viewedAt = "2026-09-08T12:00:00.000Z") {
  return {
    id,
    name: `Posting ${id}`,
    description: "A place.",
    variant: { family: "place", subtype: "workspace" },
    pricing: { currency: "CAD", daily: { amount: 120 } },
    location: { city: "Toronto", region: "Ontario", country: "Canada" },
    tags: [],
    availabilityStatus: "available" as const,
    viewedAt,
  };
}

function Consumer() {
  const { status, postings, trackingEnabled, recordView, remove, clear } =
    useRecentlyViewed();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="tracking">{trackingEnabled ? "on" : "off"}</span>
      <span data-testid="ids">
        {postings.map((posting) => posting.id).join(",")}
      </span>
      <button type="button" onClick={() => recordView("posting-new")}>
        record
      </button>
      <button type="button" onClick={() => void remove("posting-a")}>
        remove
      </button>
      <button type="button" onClick={() => void clear()}>
        clear
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <RecentlyViewedProvider>
      <Consumer />
    </RecentlyViewedProvider>,
  );
}

function anonymous() {
  useAuthMock.mockReturnValue({ status: "anonymous", session: null });
}

function authenticated(userId = "user-1") {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session: { user: { id: userId } },
  });
}

function storedEntryIds(): string[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  return (JSON.parse(raw).entries as { id: string }[]).map((entry) => entry.id);
}

describe("RecentlyViewedProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCacheForTests();
    batchPublicMock.mockResolvedValue({ postings: [], missingIds: [] });
    listMock.mockResolvedValue({ postings: [], trackingEnabled: true });
    syncMock.mockResolvedValue({ postings: [], trackingEnabled: true });
    clearMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
    recordViewMock.mockResolvedValue(true);
  });

  describe("anonymous visitors", () => {
    it("hydrates the local list through the public batch endpoint", async () => {
      recordLocalView("posting-a", 2000);
      recordLocalView("posting-b", 1000);
      anonymous();
      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-a"), makePosting("posting-b")],
        missingIds: [],
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(batchPublicMock).toHaveBeenCalledWith(["posting-a", "posting-b"]);
      expect(screen.getByTestId("ids")).toHaveTextContent(
        "posting-a,posting-b",
      );
      // Nothing is written to the account for a signed-out visitor.
      expect(listMock).not.toHaveBeenCalled();
      expect(syncMock).not.toHaveBeenCalled();
    });

    it("skips the request entirely with no local history", async () => {
      anonymous();

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(batchPublicMock).not.toHaveBeenCalled();
    });

    it("prunes postings the batch could not return", async () => {
      recordLocalView("posting-a", 2000);
      recordLocalView("posting-gone", 1000);
      anonymous();
      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        missingIds: ["posting-gone"],
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );
      expect(storedEntryIds()).toEqual(["posting-a"]);
    });

    it("reports an error when hydration fails", async () => {
      recordLocalView("posting-a", 2000);
      anonymous();
      batchPublicMock.mockRejectedValue(new Error("offline"));

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );
    });

    // The adjacent hardening to the P1 fix below: a mirror left behind by a
    // previous account must not even be *displayed* to whoever browses
    // anonymously next, not just kept from being uploaded.
    it("shows nothing when the mirror belongs to an account that has since signed out", async () => {
      adoptForAccount("user-a", [{ id: "posting-secret", at: 1000 }]);
      anonymous();

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(screen.getByTestId("ids")).toHaveTextContent("");
      expect(batchPublicMock).not.toHaveBeenCalled();
    });
  });

  describe("while the session is still resolving", () => {
    // A returning visitor sits in "loading" while /auth/refresh settles. Acting
    // then would sync one identity's history into another.
    it("issues no request at all", async () => {
      recordLocalView("posting-a", 2000);
      useAuthMock.mockReturnValue({ status: "loading", session: null });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("loading"),
      );
      expect(batchPublicMock).not.toHaveBeenCalled();
      expect(listMock).not.toHaveBeenCalled();
      expect(syncMock).not.toHaveBeenCalled();
    });
  });

  describe("signed-in visitors", () => {
    it("syncs the local mirror up and adopts the merged answer", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();
      syncMock.mockResolvedValue({
        postings: [
          makePosting("posting-server", "2026-09-07T00:00:00.000Z"),
          makePosting("posting-a", "2026-09-06T00:00:00.000Z"),
        ],
        trackingEnabled: true,
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(syncMock).toHaveBeenCalledWith(
        [{ postingId: "posting-a", viewedAt: new Date(2000).toISOString() }],
        { limit: 50 },
        expect.anything(),
      );
      // The server merged both sides; its answer is adopted wholesale rather
      // than unioned again here.
      expect(screen.getByTestId("ids")).toHaveTextContent(
        "posting-server,posting-a",
      );
      expect(listMock).not.toHaveBeenCalled();
    });

    it("lists rather than syncing when there is nothing local to send", async () => {
      authenticated();
      listMock.mockResolvedValue({
        postings: [makePosting("posting-server")],
        trackingEnabled: true,
      });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-server"),
      );
      expect(syncMock).not.toHaveBeenCalled();
      expect(listMock).toHaveBeenCalledWith({ limit: 50 }, expect.anything());
    });

    it("syncs only once per session", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();

      const { rerender } = renderProvider();

      await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

      rerender(
        <RecentlyViewedProvider>
          <Consumer />
        </RecentlyViewedProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(syncMock).toHaveBeenCalledTimes(1);
    });

    it("adopts an opt-out made on another device", async () => {
      authenticated();
      listMock.mockResolvedValue({ postings: [], trackingEnabled: false });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("tracking")).toHaveTextContent("off"),
      );
    });

    it("reports an error when the load fails", async () => {
      authenticated();
      listMock.mockRejectedValue(new Error("offline"));

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );
    });

    // The actual P1 fix: a mirror left behind by a previous account must
    // never be uploaded into a *different* account that signs in on the same
    // browser, and that account must never even glimpse the previous
    // account's postings.
    describe("switching accounts on a shared browser", () => {
      it("never uploads a previous account's mirror into a different account", async () => {
        adoptForAccount("user-a", [{ id: "posting-secret", at: 1000 }]);
        authenticated("user-b");
        listMock.mockResolvedValue({
          postings: [makePosting("posting-b-own")],
          trackingEnabled: true,
        });

        renderProvider();

        await waitFor(() =>
          expect(screen.getByTestId("ids")).toHaveTextContent("posting-b-own"),
        );
        expect(syncMock).not.toHaveBeenCalled();
        expect(screen.getByTestId("ids")).not.toHaveTextContent(
          "posting-secret",
        );
        expect(storedEntryIds()).not.toContain("posting-secret");
      });

      it("still uploads genuinely unclaimed anonymous browsing to the first account that signs in", async () => {
        // No prior owner -- true anonymous browsing before any login, which
        // must keep working exactly as before this fix.
        recordLocalView("posting-anon", 1000);
        authenticated("user-b");
        syncMock.mockResolvedValue({
          postings: [makePosting("posting-anon")],
          trackingEnabled: true,
        });

        renderProvider();

        await waitFor(() =>
          expect(screen.getByTestId("ids")).toHaveTextContent("posting-anon"),
        );
        expect(syncMock).toHaveBeenCalled();
      });

      it("re-syncs correctly when the same account signs back in after an intervening sign-out", async () => {
        adoptForAccount("user-a", [{ id: "posting-a-own", at: 1000 }]);
        authenticated("user-a");
        listMock.mockResolvedValue({
          postings: [makePosting("posting-a-own")],
          trackingEnabled: true,
        });

        renderProvider();

        await waitFor(() =>
          expect(screen.getByTestId("ids")).toHaveTextContent("posting-a-own"),
        );
        // Already this account's own mirror -- nothing new to push up.
        expect(syncMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("recording", () => {
    it("writes locally and fires the request", async () => {
      anonymous();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      expect(recordViewMock).toHaveBeenCalledWith("posting-new");
      expect(storedEntryIds()).toContain("posting-new");
    });

    // The provider lives in the root layout, so it stays mounted across
    // client-side navigation. A view recorded on a posting page has to show up
    // when the visitor then navigates to a page that renders the row.
    it("re-hydrates a signed-out list after a new view", async () => {
      anonymous();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-new")],
        missingIds: [],
      });

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-new"),
      );
    });

    it("re-reads a signed-in list after a new view is accepted", async () => {
      authenticated();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );
      expect(listMock).toHaveBeenCalledTimes(1);

      listMock.mockResolvedValue({
        postings: [makePosting("posting-new")],
        trackingEnabled: true,
      });

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-new"),
      );
      // Re-read, not re-synced: the mirror is already in step with the account.
      expect(syncMock).not.toHaveBeenCalled();
    });

    // The P2 fix: the optional-auth POST swallows its own failure and always
    // resolves, so without gating the refresh on its outcome, a failed write
    // would still trigger a re-list -- adopting a server answer that never
    // got the new posting, and erasing it from the local mirror in the
    // process.
    it("keeps the newly recorded entry locally when the write is not accepted", async () => {
      authenticated();
      recordViewMock.mockResolvedValue(false);
      listMock.mockResolvedValue({
        postings: [makePosting("posting-existing")],
        trackingEnabled: true,
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-existing"),
      );
      expect(listMock).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      await waitFor(() => expect(recordViewMock).toHaveBeenCalled());
      // No re-fetch was triggered, so the account view was never given a
      // chance to overwrite the local write with a stale answer.
      expect(listMock).toHaveBeenCalledTimes(1);
      expect(storedEntryIds()).toContain("posting-new");
    });

    it("records nothing at all once tracking is off", async () => {
      setTrackingEnabled(false);
      anonymous();
      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      await userEvent.click(screen.getByRole("button", { name: "record" }));

      expect(recordViewMock).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe("removing and clearing", () => {
    it("removes locally and on the server", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();
      syncMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        trackingEnabled: true,
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "remove" }));

      expect(removeMock).toHaveBeenCalledWith("posting-a");
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent(""),
      );
    });

    it("does not call the server for a signed-out visitor", async () => {
      recordLocalView("posting-a", 2000);
      anonymous();
      batchPublicMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        missingIds: [],
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "remove" }));

      expect(removeMock).not.toHaveBeenCalled();
      expect(storedEntryIds()).toEqual([]);
    });

    it("toasts and reloads when a removal fails", async () => {
      recordLocalView("posting-a", 2000);
      authenticated();
      syncMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        trackingEnabled: true,
      });
      removeMock.mockRejectedValue(new Error("offline"));

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "remove" }));

      await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
      expect(showErrorMock.mock.calls[0][0].tone).toBe("error");
    });

    it("clears locally and on the server", async () => {
      authenticated();
      listMock.mockResolvedValue({
        postings: [makePosting("posting-a")],
        trackingEnabled: true,
      });

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent("posting-a"),
      );

      await userEvent.click(screen.getByRole("button", { name: "clear" }));

      expect(clearMock).toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByTestId("ids")).toHaveTextContent(""),
      );
    });

    it("toasts when clearing fails", async () => {
      authenticated();
      clearMock.mockRejectedValue(new Error("offline"));

      renderProvider();
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("ready"),
      );

      await userEvent.click(screen.getByRole("button", { name: "clear" }));

      await waitFor(() => expect(showErrorMock).toHaveBeenCalled());
    });
  });

  it("refuses to be used outside the provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => render(<Consumer />)).toThrow(
      /must be used within a RecentlyViewedProvider/,
    );

    consoleError.mockRestore();
  });
});
