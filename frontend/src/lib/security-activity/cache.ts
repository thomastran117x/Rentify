import {
  readStoredSession,
  subscribeToStoredSession,
} from "@/lib/auth/storage";
import type {
  ListSecurityActivityInput,
  SecurityActivityList,
} from "@/lib/security-activity/types";

/** Served as-is, with no request, while this young. */
export const ACTIVITY_CACHE_FRESH_MS = 60_000;
/** Shown at once and refreshed in the background up to this age; then dropped. */
export const ACTIVITY_CACHE_MAX_AGE_MS = 5 * 60_000;
/** Distinct filter combinations kept; the least recently stored goes first. */
export const ACTIVITY_CACHE_MAX_ENTRIES = 20;

interface CacheEntry {
  list: SecurityActivityList;
  storedAt: number;
}

// Module memory only: nothing reaches localStorage, so a signed-out user's
// history does not survive a reload or reach another tab.
const entries = new Map<string, CacheEntry>();
let watchingSession = false;

/**
 * Empties the cache whenever the signed-in user changes, sign-out included.
 * Signing out and back in as the same account passes through "no user", so
 * a new session never sees the previous one's "This session" flags.
 */
function watchSession(): void {
  if (watchingSession) {
    return;
  }

  watchingSession = true;
  let userId = readStoredSession()?.user.id ?? null;

  subscribeToStoredSession(() => {
    const nextUserId = readStoredSession()?.user.id ?? null;

    if (nextUserId !== userId) {
      entries.clear();
    }

    userId = nextUserId;
  });
}

/**
 * Scoped by user so another account signed in on the same tab never sees
 * this one's history, and by every filter that changes the first page.
 */
export function activityCacheKey(
  userId: string,
  input: ListSecurityActivityInput,
): string {
  return JSON.stringify([
    userId,
    input.category ?? null,
    input.outcome ?? null,
    input.from ?? null,
    input.to ?? null,
    input.limit ?? null,
  ]);
}

export function readActivityCache(
  key: string,
  now: number = Date.now(),
): { list: SecurityActivityList; fresh: boolean } | null {
  const entry = entries.get(key);

  if (!entry) {
    return null;
  }

  const age = now - entry.storedAt;

  if (age > ACTIVITY_CACHE_MAX_AGE_MS) {
    entries.delete(key);
    return null;
  }

  return { list: entry.list, fresh: age <= ACTIVITY_CACHE_FRESH_MS };
}

export function writeActivityCache(
  key: string,
  list: SecurityActivityList,
  now: number = Date.now(),
): void {
  watchSession();
  entries.delete(key);
  entries.set(key, { list, storedAt: now });

  while (entries.size > ACTIVITY_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    entries.delete(oldest);
  }
}

export function clearActivityCache(): void {
  entries.clear();
}
