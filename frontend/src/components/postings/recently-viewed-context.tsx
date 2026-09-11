"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { postingsApi } from "@/lib/postings/api";
import type { PublicPostingSummary } from "@/lib/postings/search";
import {
  RECENTLY_VIEWED_SYNC_MAX,
  recentlyViewedApi,
  type RecentlyViewedPostingSummary,
} from "@/lib/recently-viewed/api";
import {
  adoptForAccount,
  clearAll as clearLocal,
  getOwner,
  getServerSnapshot,
  getSnapshot,
  getTrackingServerSnapshot,
  isTrackingEnabled as readTrackingEnabled,
  reconcileIdentity,
  recordView as recordLocalView,
  removeEntry as removeLocalEntry,
  replaceAll as replaceLocal,
  setTrackingEnabled as writeTrackingEnabled,
  subscribe,
  type RecentlyViewedEntry,
} from "@/lib/recently-viewed/storage";

export type RecentlyViewedStatus = "loading" | "ready" | "error";

interface RecentlyViewedContextValue {
  status: RecentlyViewedStatus;
  /** Hydrated cards, most recently viewed first. */
  postings: RecentlyViewedPostingSummary[];
  /** Whether this browser is still recording views. */
  trackingEnabled: boolean;
  recordView: (postingId: string) => void;
  remove: (postingId: string) => Promise<void>;
  clear: () => Promise<void>;
  setTrackingEnabled: (enabled: boolean) => void;
  refresh: () => void;
}

const RecentlyViewedContext = createContext<RecentlyViewedContextValue | null>(
  null,
);

function toSummary(
  posting: PublicPostingSummary,
  viewedAt: number,
): RecentlyViewedPostingSummary {
  return { ...posting, viewedAt: new Date(viewedAt).toISOString() };
}

export function RecentlyViewedProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, session } = useAuth();
  const { showError } = useErrorToast();

  const entries = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Read through the same store as the entries. The preference is external
  // state, so mirroring it into component state would only add a render pass
  // and would miss changes made in another tab.
  const trackingEnabled = useSyncExternalStore(
    subscribe,
    readTrackingEnabled,
    getTrackingServerSnapshot,
  );

  const [postings, setPostings] = useState<RecentlyViewedPostingSummary[]>([]);
  const [status, setStatus] = useState<RecentlyViewedStatus>("loading");
  const [refreshToken, setRefreshToken] = useState(0);

  const userId = session?.user?.id ?? null;
  const identity = authStatus === "authenticated" ? userId : null;

  // Changes whenever the local mirror changes, which is what makes the
  // signed-out list re-hydrate. The provider lives in the root layout and so
  // stays mounted across client-side navigation: without this, a view
  // recorded on a posting page would not appear when the visitor navigated
  // to a page that renders the row.
  // The signed-in branch is driven by `refreshToken` instead, because it
  // writes the mirror itself and would otherwise re-enter the effect on its
  // own output.
  const localHydrationKey =
    authStatus === "authenticated"
      ? ""
      : entries.map((entry) => entry.id).join(",");

  useEffect(() => {
    // A returning visitor sits in "loading" while /auth/refresh settles. Acting
    // on that would sync one identity's history into another, so nothing runs
    // until the status resolves. The local list is already on screen.
    if (authStatus === "loading") {
      return;
    }

    let active = true;
    const controller = new AbortController();

    // Runs first, synchronously, on every identity resolution. If the mirror
    // belonged to a different specific account, this resets it to a fresh,
    // unclaimed mirror before either branch below reads it -- so neither
    // branch has to special-case a foreign owner itself. See the doc comment
    // on `reconcileIdentity` for why this is safe.
    reconcileIdentity(identity);

    async function hydrateAnonymous() {
      const localEntries = getSnapshot();

      if (localEntries.length === 0) {
        setPostings([]);
        setStatus("ready");
        return;
      }

      try {
        const batch = await postingsApi.batchPublic(
          localEntries.map((entry) => entry.id),
        );

        if (!active) {
          return;
        }

        const viewedAtById = new Map(
          localEntries.map((entry) => [entry.id, entry.at]),
        );

        // Anything the batch could not return is gone for good, so it is
        // dropped from the mirror rather than retried on every page.
        if (batch.missingIds.length > 0) {
          replaceLocal(
            localEntries.filter(
              (entry) => !batch.missingIds.includes(entry.id),
            ),
          );
        }

        setPostings(
          batch.postings.map((posting) =>
            toSummary(posting, viewedAtById.get(posting.id) ?? 0),
          ),
        );
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }

    async function loadAuthenticated(currentUserId: string) {
      const localEntries = getSnapshot();
      // Reconciliation above guarantees the mirror is now either unclaimed or
      // already this account's own -- never a different account's. Uploading
      // is only meaningful in the unclaimed case: once the mirror is already
      // this account's, it was last written by adopting the server's own
      // answer, so there is nothing local-only left to push up.
      const shouldSync = getOwner() === null && localEntries.length > 0;

      try {
        const result = shouldSync
          ? await recentlyViewedApi.sync(
              localEntries.map((entry) => ({
                postingId: entry.id,
                viewedAt: new Date(entry.at).toISOString(),
              })),
              { limit: RECENTLY_VIEWED_SYNC_MAX },
              controller.signal,
            )
          : await recentlyViewedApi.list(
              { limit: RECENTLY_VIEWED_SYNC_MAX },
              controller.signal,
            );

        if (!active) {
          return;
        }

        // The server already merged both sides with the later timestamp
        // winning, so its answer is adopted wholesale rather than unioned
        // again on the client. This also claims the mirror for this account,
        // discarding anything foreign reconciliation may have missed.
        adoptForAccount(
          currentUserId,
          result.postings.map((posting) => ({
            id: posting.id,
            at: Date.parse(posting.viewedAt),
          })),
        );
        writeTrackingEnabled(result.trackingEnabled);
        setPostings(result.postings);
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }

    setStatus("loading");

    if (authStatus === "authenticated" && userId) {
      void loadAuthenticated(userId);
    } else {
      void hydrateAnonymous();
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [authStatus, userId, identity, refreshToken, localHydrationKey]);

  const recordView = useCallback(
    (postingId: string) => {
      if (!readTrackingEnabled()) {
        return;
      }

      // Guards the same window `reconcileIdentity` in the effect guards: a
      // view fired the instant an identity changes, before the effect above
      // has re-run, must not be appended onto a mirror that still belongs to
      // whoever was previously using this browser.
      reconcileIdentity(identity);
      recordLocalView(postingId);

      void (async () => {
        const accepted = await recentlyViewedApi.recordView(postingId);

        // Only refresh from the account once the write is confirmed. The
        // optional-auth POST swallows its own failure and resolves either
        // way, so without this a failed write's re-list would adopt a server
        // answer that never got the new posting, silently erasing the entry
        // this session just recorded locally.
        if (accepted && authStatus === "authenticated") {
          setRefreshToken((current) => current + 1);
        }
      })();
    },
    [authStatus, identity],
  );

  const remove = useCallback(
    async (postingId: string) => {
      removeLocalEntry(postingId);
      setPostings((current) =>
        current.filter((posting) => posting.id !== postingId),
      );

      if (authStatus !== "authenticated") {
        return;
      }

      try {
        await recentlyViewedApi.remove(postingId);
      } catch (error) {
        // Reported as a toast rather than through the page-level error state,
        // which would replace the very list the visitor is editing.
        showError({
          title: "Couldn't remove that posting",
          message: getApiErrorMessage(error, {
            action: "remove that posting from your history",
            fallback:
              "We couldn't update your recently viewed postings. Please try again.",
          }),
          tone: "error",
        });
        setRefreshToken((current) => current + 1);
      }
    },
    [authStatus, showError],
  );

  const clear = useCallback(async () => {
    clearLocal();
    setPostings([]);

    if (authStatus !== "authenticated") {
      return;
    }

    try {
      await recentlyViewedApi.clear();
    } catch (error) {
      showError({
        title: "Couldn't clear your history",
        message: getApiErrorMessage(error, {
          action: "clear your recently viewed postings",
          fallback:
            "We couldn't clear your recently viewed postings. Please try again.",
        }),
        tone: "error",
      });
      setRefreshToken((current) => current + 1);
    }
  }, [authStatus, showError]);

  const setTrackingEnabled = useCallback((enabled: boolean) => {
    writeTrackingEnabled(enabled);
  }, []);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  const value = useMemo<RecentlyViewedContextValue>(
    () => ({
      status,
      postings,
      trackingEnabled,
      recordView,
      remove,
      clear,
      setTrackingEnabled,
      refresh,
    }),
    [
      clear,
      postings,
      recordView,
      refresh,
      remove,
      setTrackingEnabled,
      status,
      trackingEnabled,
    ],
  );

  return (
    <RecentlyViewedContext.Provider value={value}>
      {children}
    </RecentlyViewedContext.Provider>
  );
}

export function useRecentlyViewed(): RecentlyViewedContextValue {
  const context = useContext(RecentlyViewedContext);

  if (!context) {
    throw new Error(
      "useRecentlyViewed must be used within a RecentlyViewedProvider.",
    );
  }

  return context;
}

export type { RecentlyViewedEntry };
