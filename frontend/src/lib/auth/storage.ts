import type { StoredAuthSession } from "@/lib/auth/types";

const SESSION_STORAGE_KEY = "rentify.auth.session";
const AUTH_STORAGE_SIGNAL_KEY = "rentify.auth.signal";
const AUTH_STORAGE_EVENT = "rentify-auth-storage";
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

export function writeStoredSession(session: StoredAuthSession): void {
  memorySession = session;
  clearLegacyLocalStorageSession();
  emitStorageChange();
}

export function clearStoredSession(): void {
  memorySession = null;
  clearLegacyLocalStorageSession();
  emitStorageChange();
}
