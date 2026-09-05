import type { StoredAuthSession } from "@/lib/auth/types";

const SESSION_STORAGE_KEY = "rentify.auth.session";
const AUTH_STORAGE_SIGNAL_KEY = "rentify.auth.signal";
const AUTH_STORAGE_EVENT = "rentify-auth-storage";
/**
 * Non-sensitive marker recording only that this browser had a session, so the
 * root layout can decide before first paint whether the app shell should
 * reserve its sidebar. The session itself is deliberately memory-only and is
 * restored through the refresh cookie, which means auth status is otherwise
 * unknowable until that round-trip finishes — and the shell would jump.
 */
const AUTH_ACTIVE_HINT_KEY = "rentify.auth.active";
let memorySession: StoredAuthSession | null = null;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function clearLegacyLocalStorageSession(): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function readStoredSession(): StoredAuthSession | null {
  clearLegacyLocalStorageSession();
  return memorySession;
}

function emitStorageChange(): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_SIGNAL_KEY, String(Date.now()));
  window.dispatchEvent(new Event(AUTH_STORAGE_EVENT));
}

export function getStoredSessionSnapshot():
  | StoredAuthSession
  | null
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return readStoredSession();
}

export function subscribeToStoredSession(
  onStoreChange: () => void,
): () => void {
  if (!canUseStorage()) {
    return () => undefined;
  }

  const handleChange = () => {
    onStoreChange();
  };
  const handleStorageChange = (event: StorageEvent) => {
    if (
      event.key === AUTH_STORAGE_SIGNAL_KEY ||
      event.key === SESSION_STORAGE_KEY
    ) {
      handleChange();
    }
  };

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(AUTH_STORAGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(AUTH_STORAGE_EVENT, handleChange);
  };
}

function writeAuthActiveHint(active: boolean): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    if (active) {
      window.localStorage.setItem(AUTH_ACTIVE_HINT_KEY, "1");
    } else {
      window.localStorage.removeItem(AUTH_ACTIVE_HINT_KEY);
    }
  } catch {
    // Private browsing can refuse writes; the hint is best-effort.
  }
}

/**
 * Drop the pre-paint marker without touching the session or notifying
 * subscribers. Used when initial restoration resolves anonymous: the refresh
 * cookie can lapse while the app is closed, and nothing else would clear a
 * marker left over from that session.
 */
export function clearAuthActiveHint(): void {
  writeAuthActiveHint(false);
}

export function writeStoredSession(session: StoredAuthSession): void {
  memorySession = session;
  clearLegacyLocalStorageSession();
  writeAuthActiveHint(true);
  emitStorageChange();
}

export function clearStoredSession(): void {
  memorySession = null;
  clearLegacyLocalStorageSession();
  writeAuthActiveHint(false);
  emitStorageChange();
}
