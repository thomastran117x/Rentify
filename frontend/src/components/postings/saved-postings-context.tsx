"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { savedPostingsApi } from "@/lib/saved-postings/api";

export type SavedPostingsStatus = "anonymous" | "loading" | "ready" | "error";

interface SavedPostingsContextValue {
  status: SavedPostingsStatus;
  /** True when the caller has more saved postings than the id set carries. */
  truncated: boolean;
  isSaved: (postingId: string) => boolean;
  isPending: (postingId: string) => boolean;
  /**
   * Flips saved state optimistically, reconciling to the server's answer and
   * rolling back that one posting on failure. Anonymous visitors are sent to
   * the login page instead.
   */
  toggleSaved: (postingId: string) => Promise<void>;
  /**
   * Seeds identifiers a caller already knows are saved, so a list that
   * arrives before the identifier request does not render its hearts unsaved.
   */
  markSaved: (postingIds: string[]) => void;
  refresh: () => void;
  subscribe: () => () => void;
}

const SavedPostingsContext = createContext<SavedPostingsContextValue | null>(
  null,
);

interface SavedPostingsProviderProps {
  children: ReactNode;
}

export function SavedPostingsProvider({
  children,
}: SavedPostingsProviderProps) {
  const { status: authStatus } = useAuth();
  const { showError } = useErrorToast();
  const router = useRouter();
  const pathname = usePathname();

  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [status, setStatus] = useState<SavedPostingsStatus>("loading");
  const [truncated, setTruncated] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // Consumers register themselves so the id set is only fetched on pages that
  // actually render saved state, not on every page under the root layout.
  const [subscriberCount, setSubscriberCount] = useState(0);
  // Deliberately a boolean rather than the count: consumers mount in more than
  // one commit (the saved page renders its cards only after the list arrives),
  // and depending on the count would abort the in-flight request and re-issue
  // it every time another heart appeared.
  const hasSubscribers = subscriberCount > 0;

  // Mirror of the set so `toggleSaved` can read current state without being
  // rebuilt (and re-rendering every heart) each time the set changes.
  const savedIdsRef = useRef<ReadonlySet<string>>(savedIds);
  savedIdsRef.current = savedIds;

  // The most recent state this session established for a posting, whether by
  // an explicit toggle or by seeding. The identifier request is a snapshot
  // taken at request time, so without this a toggle that lands while that
  // request is in flight would be wiped when the stale snapshot arrives.
  const localStateRef = useRef(new Map<string, boolean>());

  /** A toggle clicked before the auth status was known. */
  const pendingAuthToggleRef = useRef<string | null>(null);

  const subscribe = useCallback(() => {
    setSubscriberCount((current) => current + 1);

    return () => {
      setSubscriberCount((current) => Math.max(0, current - 1));
    };
  }, []);

  const applySaved = useCallback((postingId: string, saved: boolean) => {
    localStateRef.current.set(postingId, saved);
    setSavedIds((current) => {
      if (current.has(postingId) === saved) {
        return current;
      }

      const next = new Set(current);

      if (saved) {
        next.add(postingId);
      } else {
        next.delete(postingId);
      }

      return next;
    });
  }, []);

  const markPending = useCallback((postingId: string, pending: boolean) => {
    setPendingIds((current) => {
      if (current.has(postingId) === pending) {
        return current;
      }

      const next = new Set(current);

      if (pending) {
        next.add(postingId);
      } else {
        next.delete(postingId);
      }

      return next;
    });
  }, []);

  useEffect(() => {
    if (authStatus === "anonymous") {
      localStateRef.current.clear();
      setSavedIds(new Set<string>());
      setTruncated(false);
      setStatus("anonymous");
      return;
    }

    if (authStatus !== "authenticated" || !hasSubscribers) {
      return;
    }

    let active = true;
    const controller = new AbortController();
    setStatus("loading");

    async function loadSavedIds() {
      try {
        const result = await savedPostingsApi.listIds(controller.signal);

        if (!active) {
          return;
        }

        const snapshot = new Set(result.postingIds);

        for (const [postingId, saved] of localStateRef.current) {
          if (saved) {
            snapshot.add(postingId);
          } else {
            snapshot.delete(postingId);
          }
        }

        setSavedIds(snapshot);
        setTruncated(result.truncated);
        setStatus("ready");
      } catch {
        if (active) {
          // Non-fatal: hearts render unsaved and a click still reaches the
          // API, which is idempotent.
          setStatus("error");
        }
      }
    }

    void loadSavedIds();

    return () => {
      active = false;
      controller.abort();
    };
  }, [authStatus, hasSubscribers, refreshToken]);

  const redirectToLogin = useCallback(() => {
    // usePathname drops the query string, and losing it would drop the
    // visitor's search on the way back from signing in. The handler runs in
    // the browser, so the live location is authoritative and, unlike
    // useSearchParams, costs no render-time subscription.
    const search = typeof window === "undefined" ? "" : window.location.search;
    const next = `${pathname || "/"}${search}`;

    router.push(`/login?next=${encodeURIComponent(next)}`);
  }, [pathname, router]);

  const toggleSaved = useCallback(
    async (postingId: string) => {
      // A returning visitor is "loading" until the refresh round trip settles,
      // and the cards are already on screen by then. Treating that as
      // anonymous would bounce a signed-in user to the login page, so the
      // intent is held and replayed once the status is known.
      if (authStatus === "loading") {
        pendingAuthToggleRef.current = postingId;
        markPending(postingId, true);
        return;
      }

      if (authStatus !== "authenticated") {
        redirectToLogin();
        return;
      }

      const nextSaved = !savedIdsRef.current.has(postingId);

      applySaved(postingId, nextSaved);
      markPending(postingId, true);

      try {
        const state = nextSaved
          ? await savedPostingsApi.save(postingId)
          : await savedPostingsApi.unsave(postingId);

        applySaved(postingId, state.saved);
      } catch (error) {
        applySaved(postingId, !nextSaved);
        showError({
          title: nextSaved
            ? "Couldn't save posting"
            : "Couldn't remove saved posting",
          message: getApiErrorMessage(error, {
            action: nextSaved
              ? "save this posting"
              : "remove this posting from your saved postings",
            fallback:
              "We couldn't update your saved postings. Please try again.",
          }),
          tone: "error",
        });
      } finally {
        markPending(postingId, false);
      }
    },
    [applySaved, authStatus, markPending, redirectToLogin, showError],
  );

  // Replays a toggle that was clicked while the auth status was still
  // settling, so the click either performs the save or reaches the login page
  // rather than being silently dropped.
  useEffect(() => {
    const postingId = pendingAuthToggleRef.current;

    if (!postingId || authStatus === "loading") {
      return;
    }

    pendingAuthToggleRef.current = null;
    markPending(postingId, false);
    void toggleSaved(postingId);
  }, [authStatus, markPending, toggleSaved]);

  const markSaved = useCallback((postingIds: string[]) => {
    for (const postingId of postingIds) {
      localStateRef.current.set(postingId, true);
    }

    setSavedIds((current) => {
      const missing = postingIds.filter((postingId) => !current.has(postingId));

      if (missing.length === 0) {
        return current;
      }

      const next = new Set(current);

      for (const postingId of missing) {
        next.add(postingId);
      }

      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  const value = useMemo<SavedPostingsContextValue>(
    () => ({
      status,
      truncated,
      isSaved: (postingId: string) => savedIds.has(postingId),
      isPending: (postingId: string) => pendingIds.has(postingId),
      toggleSaved,
      markSaved,
      refresh,
      subscribe,
    }),
    [
      markSaved,
      pendingIds,
      refresh,
      savedIds,
      status,
      subscribe,
      toggleSaved,
      truncated,
    ],
  );

  return (
    <SavedPostingsContext.Provider value={value}>
      {children}
    </SavedPostingsContext.Provider>
  );
}

export function useSavedPostings(): SavedPostingsContextValue {
  const context = useContext(SavedPostingsContext);

  if (!context) {
    throw new Error(
      "useSavedPostings must be used within a SavedPostingsProvider.",
    );
  }

  const { subscribe } = context;

  useEffect(() => subscribe(), [subscribe]);

  return context;
}
