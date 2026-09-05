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
  // would reserve the sidebar and then drop it. Retire the marker as soon as
  // restoration actually resolves anonymous.
  useEffect(() => {
    if (status === "anonymous") {
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
