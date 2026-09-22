"use client";

import { useEffect, useRef } from "react";
import type { StoredAuthSession } from "@/lib/auth/types";
import { authApi } from "@/lib/auth/api";
import { readAccessTokenTiming } from "@/lib/auth/access-token";

interface SessionManagerProps {
  session: StoredAuthSession | null | undefined;
  onComplete: () => void;
}

const REFRESH_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

function isPageActive(): boolean {
  return (
    document.visibilityState === "visible" &&
    (typeof navigator === "undefined" || navigator.onLine)
  );
}

export function SessionManager({ session, onComplete }: SessionManagerProps) {
  const hasAttemptedInitialRestore = useRef(false);

  useEffect(() => {
    if (session === undefined || hasAttemptedInitialRestore.current) {
      return;
    }

    hasAttemptedInitialRestore.current = true;

    async function restoreSession() {
      try {
        if (!session && authApi.hasRefreshCookieHint()) {
          await authApi.refresh();
        }
      } catch (error) {
        console.error("Unable to restore session from refresh cookie hint.", {
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        onComplete();
      }
    }

    void restoreSession();
  }, [onComplete, session]);

  useEffect(() => {
    const accessToken = session?.accessToken;

    if (!accessToken) {
      return;
    }

    const timing = readAccessTokenTiming(accessToken);

    // A malformed token cannot be timed safely. The authenticated request
    // path retains its one-time 401 refresh as a fallback for this case.
    if (!timing) {
      return;
    }

    const { refreshAtMs } = timing;

    let cancelled = false;
    let refreshInFlight = false;
    let retryAttempt = 0;
    let timerId: number | undefined;

    function clearTimer() {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
        timerId = undefined;
      }
    }

    function scheduleAfter(delayMs: number) {
      clearTimer();

      if (cancelled || !isPageActive()) {
        return;
      }

      timerId = window.setTimeout(() => {
        timerId = undefined;
        void refreshIfDue();
      }, delayMs);
    }

    function scheduleFromToken() {
      clearTimer();

      if (cancelled || !isPageActive()) {
        return;
      }

      const delayMs = Math.max(0, refreshAtMs - Date.now());

      if (delayMs === 0) {
        void refreshIfDue();
        return;
      }

      scheduleAfter(delayMs);
    }

    async function refreshIfDue() {
      if (cancelled || refreshInFlight || !isPageActive()) {
        return;
      }

      const remainingDelayMs = refreshAtMs - Date.now();

      if (remainingDelayMs > 0) {
        scheduleAfter(remainingDelayMs);
        return;
      }

      refreshInFlight = true;

      try {
        const refreshedSession = await authApi.refresh();

        if (cancelled || !refreshedSession) {
          return;
        }

        // Writing the refreshed session re-renders this component with the new
        // token, and that effect owns the next expiration timer.
        retryAttempt = 0;
      } catch {
        if (!cancelled) {
          const retryDelayMs =
            REFRESH_RETRY_DELAYS_MS[
              Math.min(retryAttempt, REFRESH_RETRY_DELAYS_MS.length - 1)
            ];
          retryAttempt += 1;
          scheduleAfter(retryDelayMs);
        }
      } finally {
        refreshInFlight = false;
      }
    }

    function handlePageActivityChange() {
      if (!isPageActive()) {
        clearTimer();
        return;
      }

      scheduleFromToken();
    }

    scheduleFromToken();
    document.addEventListener("visibilitychange", handlePageActivityChange);
    window.addEventListener("focus", handlePageActivityChange);
    window.addEventListener("online", handlePageActivityChange);
    window.addEventListener("offline", handlePageActivityChange);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener(
        "visibilitychange",
        handlePageActivityChange,
      );
      window.removeEventListener("focus", handlePageActivityChange);
      window.removeEventListener("online", handlePageActivityChange);
      window.removeEventListener("offline", handlePageActivityChange);
    };
  }, [session?.accessToken]);

  return null;
}
