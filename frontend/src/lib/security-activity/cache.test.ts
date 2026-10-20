import { beforeEach, describe, expect, it } from "vitest";
import { clearStoredSession, writeStoredSession } from "@/lib/auth/storage";
import type { StoredAuthSession } from "@/lib/auth/types";
import {
  ACTIVITY_CACHE_FRESH_MS,
  ACTIVITY_CACHE_MAX_AGE_MS,
  ACTIVITY_CACHE_MAX_ENTRIES,
  activityCacheKey,
  clearActivityCache,
  readActivityCache,
  writeActivityCache,
} from "@/lib/security-activity/cache";

const LIST = { items: [], nextCursor: "cursor-1" };

describe("security activity cache", () => {
  beforeEach(() => {
    clearActivityCache();
  });

  it("keys by user and by every filter", () => {
    const base = { limit: 20, category: "sign_in" as const };

    expect(activityCacheKey("user-1", base)).toBe(
      activityCacheKey("user-1", { ...base }),
    );
    expect(activityCacheKey("user-1", base)).not.toBe(
      activityCacheKey("user-2", base),
    );
    for (const changed of [
      { ...base, category: "sessions" as const },
      { ...base, outcome: "failure" as const },
      { ...base, from: "2026-10-01T04:00:00.000Z" },
      { ...base, to: "2026-10-08T04:00:00.000Z" },
      { ...base, limit: 10 },
    ]) {
      expect(activityCacheKey("user-1", changed)).not.toBe(
        activityCacheKey("user-1", base),
      );
    }
  });

  it("is fresh, then stale, then gone as it ages", () => {
    writeActivityCache("key", LIST, 1_000);

    expect(readActivityCache("key", 1_000 + ACTIVITY_CACHE_FRESH_MS)).toEqual({
      list: LIST,
      fresh: true,
    });
    expect(
      readActivityCache("key", 1_000 + ACTIVITY_CACHE_FRESH_MS + 1),
    ).toEqual({ list: LIST, fresh: false });
    expect(
      readActivityCache("key", 1_000 + ACTIVITY_CACHE_MAX_AGE_MS + 1),
    ).toBeNull();
    expect(readActivityCache("key", 1_000)).toBeNull();
  });

  it("evicts the least recently stored entry past the cap", () => {
    for (let index = 0; index <= ACTIVITY_CACHE_MAX_ENTRIES; index += 1) {
      writeActivityCache(`key-${index}`, LIST, 1_000);
    }

    expect(readActivityCache("key-0", 1_000)).toBeNull();
    expect(readActivityCache("key-1", 1_000)).not.toBeNull();
    expect(
      readActivityCache(`key-${ACTIVITY_CACHE_MAX_ENTRIES}`, 1_000),
    ).not.toBeNull();
  });

  it("empties when the signed-in user changes or signs out", () => {
    const session = (id: string) =>
      ({
        accessToken: "token",
        user: { id, email: `${id}@example.test`, username: id, role: "user" },
      }) as unknown as StoredAuthSession;

    writeStoredSession(session("user-1"));
    writeActivityCache("key", LIST, 1_000);
    // A token refresh for the same user keeps the cache.
    writeStoredSession(session("user-1"));
    expect(readActivityCache("key", 1_000)).not.toBeNull();

    clearStoredSession();
    expect(readActivityCache("key", 1_000)).toBeNull();

    writeActivityCache("key", LIST, 1_000);
    writeStoredSession(session("user-2"));
    expect(readActivityCache("key", 1_000)).toBeNull();
    clearStoredSession();
  });

  it("refreshes an entry's position when it is stored again", () => {
    for (let index = 0; index < ACTIVITY_CACHE_MAX_ENTRIES; index += 1) {
      writeActivityCache(`key-${index}`, LIST, 1_000);
    }
    writeActivityCache("key-0", LIST, 2_000);
    writeActivityCache("key-new", LIST, 2_000);

    expect(readActivityCache("key-0", 2_000)).not.toBeNull();
    expect(readActivityCache("key-1", 2_000)).toBeNull();
  });
});
