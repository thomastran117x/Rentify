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
import { SessionManager } from "@/components/auth/session-manager";
import { authApi } from "@/lib/auth/api";
import type { AuthResponseBody, StoredAuthSession } from "@/lib/auth/types";
import {
  clearAuthActiveHint,
  clearStoredSession,
  getStoredSessionSnapshot,
  subscribeToStoredSession,
  writeStoredSession,
} from "@/lib/auth/storage";

type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  session: StoredAuthSession | null;
  setSession: (session: AuthResponseBody) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const session = useSyncExternalStore(
    subscribeToStoredSession,
    getStoredSessionSnapshot,
    () => undefined,
  );
  const [isInitialSessionRestorePending, setIsInitialSessionRestorePending] =
    useState(true);

  const handleInitialRestoreComplete = useCallback(() => {
    setIsInitialSessionRestorePending(false);
  }, []);

  const status: AuthStatus =
    session === undefined || isInitialSessionRestorePending
      ? "loading"
      : session
        ? "authenticated"
        : "anonymous";

  // The refresh cookie can lapse while the app is closed, in which case no
  // refresh runs and nothing clears the pre-paint marker — so every later visit
  // would reserve the sidebar and then drop it.
  //
  // Resolving anonymous is not enough on its own to retire it, though: a
  // transport-level failure of /auth/refresh also lands here while leaving the
  // cookies intact, and a later reload can still restore the session. Require
  // the cookie hint to be gone too, which covers a lapsed cookie and a
  // definitive rejection (the server clears the cookie) but not a flaky
  // network.
  useEffect(() => {
    if (status === "anonymous" && !authApi.hasRefreshCookieHint()) {
      clearAuthActiveHint();
    }
  }, [status]);

  const value: AuthContextValue = useMemo(
    () => ({
      status,
      session: session ?? null,
      setSession(nextSession) {
        writeStoredSession(nextSession);
      },
      clearSession() {
        clearStoredSession();
      },
    }),
    [session, status],
  );

  return (
    <AuthContext.Provider value={value}>
      <SessionManager
        session={session}
        onComplete={handleInitialRestoreComplete}
      />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
