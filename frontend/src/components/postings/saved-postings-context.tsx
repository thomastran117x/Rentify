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

  // Mirror of the set so `toggleSaved` can read current state without being
  // rebuilt (and re-rendering every heart) each time the set changes.
  const savedIdsRef = useRef<ReadonlySet<string>>(savedIds);
  savedIdsRef.current = savedIds;

  const subscribe = useCallback(() => {
    setSubscriberCount((current) => current + 1);

    return () => {
      setSubscriberCount((current) => Math.max(0, current - 1));
    };
  }, []);

  const applySaved = useCallback((postingId: string, saved: boolean) => {
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
      setSavedIds(new Set<string>());
      setTruncated(false);
      setStatus("anonymous");
      return;
    }

    if (authStatus !== "authenticated" || subscriberCount === 0) {
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

        setSavedIds(new Set(result.postingIds));
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
  }, [authStatus, refreshToken, subscriberCount]);

  const toggleSaved = useCallback(
    async (postingId: string) => {
      if (authStatus !== "authenticated") {
        router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
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
    [applySaved, authStatus, markPending, pathname, router, showError],
  );

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
      refresh,
      subscribe,
    }),
    [pendingIds, refresh, savedIds, status, subscribe, toggleSaved, truncated],
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
