import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECENTLY_VIEWED_LOCAL_CAP,
  adoptForAccount,
  clearAll,
  getOwner,
  getOwnerServerSnapshot,
  getServerSnapshot,
  getSnapshot,
  getTrackingServerSnapshot,
  isTrackingEnabled,
  reconcileIdentity,
  recordView,
  removeEntry,
  replaceAll,
  resetCacheForTests,
  setTrackingEnabled,
  subscribe,
} from "./storage";

const STORAGE_KEY = "rentify.recently-viewed.v2";
const TRACKING_KEY = "rentify.recently-viewed.enabled";

function seed(
  entries: { id: string; at: number }[],
  owner: string | null = null,
): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ v: 2, owner, entries }),
  );
  resetCacheForTests();
}

function stored(): { v: number; owner: string | null; entries: unknown[] } {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  return raw ? JSON.parse(raw) : { v: 2, owner: null, entries: [] };
}

describe("recently viewed storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCacheForTests();
  });

  describe("snapshot identity", () => {
    // This is the one that matters: useSyncExternalStore compares snapshots by
    // reference, so a getter that allocates renders forever.
    it("returns the same reference across repeated reads", () => {
      seed([{ id: "posting-1", at: 1000 }]);

      expect(getSnapshot()).toBe(getSnapshot());
    });

    it("returns the same reference when storage is empty", () => {
      expect(getSnapshot()).toBe(getSnapshot());
    });

    it("returns a stable server snapshot that matches the empty client read", () => {
      expect(getServerSnapshot()).toBe(getServerSnapshot());
      expect(getServerSnapshot()).toEqual([]);
      expect(getSnapshot()).toBe(getServerSnapshot());
    });

    it("hands back a new reference only after a write", () => {
      const before = getSnapshot();

      recordView("posting-1");

      expect(getSnapshot()).not.toBe(before);
    });

    it("returns a stable owner snapshot too", () => {
      expect(getOwner()).toBe(getOwnerServerSnapshot());
      expect(getOwnerServerSnapshot()).toBeNull();
    });
  });

  describe("reading damaged storage", () => {
    it("treats unparseable JSON as no history", () => {
      window.localStorage.setItem(STORAGE_KEY, "{not json");
      resetCacheForTests();

      expect(getSnapshot()).toEqual([]);
      expect(getOwner()).toBeNull();
    });

    it("treats a payload from a different version as no history", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 99,
          owner: "user-a",
          entries: [{ id: "posting-1", at: 1 }],
        }),
      );
      resetCacheForTests();

      expect(getSnapshot()).toEqual([]);
      expect(getOwner()).toBeNull();
    });

    // The pre-fix shape (`v: 1`, no `owner`) must never be interpreted as an
    // unclaimed mirror with stale entries -- version-mismatch handling already
    // covers that, but this pins it down explicitly since it is the actual
    // migration path off the vulnerable shape.
    it("discards a pre-ownership v1 payload rather than reading it as unclaimed", () => {
      window.localStorage.setItem(
        "rentify.recently-viewed.v1",
        JSON.stringify({ v: 1, entries: [{ id: "posting-1", at: 1 }] }),
      );
      resetCacheForTests();

      expect(getSnapshot()).toEqual([]);
      expect(getOwner()).toBeNull();
    });

    it("drops entries that are not shaped like entries", () => {
      seed([
        { id: "posting-1", at: 1000 },
        { id: "", at: 2000 },
        { at: 3000 } as never,
        { id: "posting-2", at: Number.NaN },
      ]);

      expect(getSnapshot()).toEqual([{ id: "posting-1", at: 1000 }]);
    });

    it("survives a storage accessor that throws", () => {
      const getItem = vi
        .spyOn(window.localStorage, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      expect(getSnapshot()).toEqual([]);

      getItem.mockRestore();
    });

    it("keeps working when a write is rejected", () => {
      const setItem = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("quota exceeded");
        });

      expect(() => recordView("posting-1")).not.toThrow();
      // The in-memory snapshot still reflects the change for this page view.
      expect(getSnapshot()).toEqual([
        { id: "posting-1", at: expect.any(Number) },
      ]);

      setItem.mockRestore();
    });
  });

  describe("recordView", () => {
    it("puts the newest view at the front", () => {
      recordView("posting-1", 1000);
      recordView("posting-2", 2000);

      expect(getSnapshot().map((entry) => entry.id)).toEqual([
        "posting-2",
        "posting-1",
      ]);
    });

    it("promotes a re-view rather than duplicating it", () => {
      recordView("posting-1", 1000);
      recordView("posting-2", 2000);
      recordView("posting-1", 3000);

      expect(getSnapshot()).toEqual([
        { id: "posting-1", at: 3000 },
        { id: "posting-2", at: 2000 },
      ]);
    });

    it("evicts the oldest entry once the cap is reached", () => {
      for (let index = 0; index < RECENTLY_VIEWED_LOCAL_CAP + 3; index += 1) {
        recordView(`posting-${index}`, 1000 + index);
      }

      const snapshot = getSnapshot();

      expect(snapshot).toHaveLength(RECENTLY_VIEWED_LOCAL_CAP);
      expect(snapshot.map((entry) => entry.id)).not.toContain("posting-0");
      expect(snapshot[0].id).toBe(`posting-${RECENTLY_VIEWED_LOCAL_CAP + 2}`);
    });

    it("persists through storage", () => {
      recordView("posting-1", 1000);

      expect(stored().entries).toEqual([{ id: "posting-1", at: 1000 }]);
    });

    it("preserves whichever account currently owns the mirror", () => {
      adoptForAccount("user-a", [{ id: "posting-1", at: 1000 }]);

      recordView("posting-2", 2000);

      expect(getOwner()).toBe("user-a");
    });
  });

  describe("removeEntry and clearAll", () => {
    it("removes one entry", () => {
      recordView("posting-1", 1000);
      recordView("posting-2", 2000);

      removeEntry("posting-1");

      expect(getSnapshot().map((entry) => entry.id)).toEqual(["posting-2"]);
    });

    it("leaves the snapshot reference alone when nothing matched", () => {
      recordView("posting-1", 1000);
      const before = getSnapshot();

      removeEntry("posting-absent");

      expect(getSnapshot()).toBe(before);
    });

    it("clears everything", () => {
      recordView("posting-1", 1000);

      clearAll();

      expect(getSnapshot()).toEqual([]);
      expect(stored().entries).toEqual([]);
    });

    it("preserves ownership through remove and clear", () => {
      adoptForAccount("user-a", [
        { id: "posting-1", at: 1000 },
        { id: "posting-2", at: 2000 },
      ]);

      removeEntry("posting-1");
      expect(getOwner()).toBe("user-a");

      clearAll();
      expect(getOwner()).toBe("user-a");
    });
  });

  describe("replaceAll", () => {
    it("adopts the given list, normalized", () => {
      recordView("posting-old", 1000);

      replaceAll([
        { id: "posting-a", at: 1000 },
        { id: "posting-b", at: 3000 },
        { id: "posting-a", at: 5000 },
      ]);

      expect(getSnapshot()).toEqual([
        { id: "posting-a", at: 5000 },
        { id: "posting-b", at: 3000 },
      ]);
    });

    it("does not change who owns the mirror", () => {
      adoptForAccount("user-a", [{ id: "posting-1", at: 1000 }]);

      replaceAll([{ id: "posting-1", at: 1000 }]);

      expect(getOwner()).toBe("user-a");
    });
  });

  describe("adoptForAccount", () => {
    it("claims the mirror for the given account", () => {
      adoptForAccount("user-a", [{ id: "posting-1", at: 1000 }]);

      expect(getOwner()).toBe("user-a");
      expect(getSnapshot()).toEqual([{ id: "posting-1", at: 1000 }]);
    });

    it("replaces entries outright, discarding anything left over from before", () => {
      adoptForAccount("user-a", [{ id: "posting-old", at: 1000 }]);

      adoptForAccount("user-a", [{ id: "posting-new", at: 2000 }]);

      expect(getSnapshot()).toEqual([{ id: "posting-new", at: 2000 }]);
    });

    // This is the actual fix: signing in as a different account must never
    // leave a previous account's entries sitting in the mirror to be
    // re-uploaded later.
    it("wipes a previous owner's entries when a different account signs in", () => {
      adoptForAccount("user-a", [{ id: "posting-secret", at: 1000 }]);

      adoptForAccount("user-b", [{ id: "posting-b-own", at: 2000 }]);

      expect(getOwner()).toBe("user-b");
      expect(getSnapshot()).toEqual([{ id: "posting-b-own", at: 2000 }]);
      expect(getSnapshot().some((entry) => entry.id === "posting-secret")).toBe(
        false,
      );
    });
  });

  describe("reconcileIdentity", () => {
    it("does nothing to a genuinely unclaimed mirror", () => {
      recordView("posting-1", 1000);

      reconcileIdentity("user-a");

      // The anonymous browsing survives to be synced up to whoever signs in
      // first -- the intended anonymous-to-first-login merge.
      expect(getSnapshot()).toEqual([{ id: "posting-1", at: 1000 }]);
    });

    it("does nothing when the mirror already belongs to this identity", () => {
      adoptForAccount("user-a", [{ id: "posting-1", at: 1000 }]);

      reconcileIdentity("user-a");

      expect(getOwner()).toBe("user-a");
      expect(getSnapshot()).toEqual([{ id: "posting-1", at: 1000 }]);
    });

    // The core of the P1 fix: user A signs out (browser goes anonymous), and
    // whoever uses the browser next -- anonymous or a different account --
    // must not inherit A's confirmed history.
    it("resets a foreign-owned mirror when the visitor is now anonymous", () => {
      adoptForAccount("user-a", [{ id: "posting-secret", at: 1000 }]);

      reconcileIdentity(null);

      expect(getOwner()).toBeNull();
      expect(getSnapshot()).toEqual([]);
    });

    it("resets a foreign-owned mirror when a different account signs in", () => {
      adoptForAccount("user-a", [{ id: "posting-secret", at: 1000 }]);

      reconcileIdentity("user-b");

      expect(getOwner()).toBeNull();
      expect(getSnapshot()).toEqual([]);
    });

    it("notifies subscribers when it resets a mismatched mirror", () => {
      adoptForAccount("user-a", [{ id: "posting-1", at: 1000 }]);
      const listener = vi.fn();
      subscribe(listener);

      reconcileIdentity("user-b");

      expect(listener).toHaveBeenCalled();
    });

    it("does not notify subscribers when there is nothing to reconcile", () => {
      const listener = vi.fn();
      subscribe(listener);

      reconcileIdentity("user-a");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("subscribers", () => {
    it("notifies on write and stops after unsubscribe", () => {
      const listener = vi.fn();
      const unsubscribe = subscribe(listener);

      recordView("posting-1", 1000);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      recordView("posting-2", 2000);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("invalidates the cache when another tab writes", () => {
      const listener = vi.fn();
      subscribe(listener);

      expect(getSnapshot()).toEqual([]);

      // Another tab's write does not go through this module's mutators.
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 2,
          owner: null,
          entries: [{ id: "posting-9", at: 9000 }],
        }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));

      expect(listener).toHaveBeenCalled();
      expect(getSnapshot()).toEqual([{ id: "posting-9", at: 9000 }]);
    });

    it("ignores storage events for unrelated keys", () => {
      const listener = vi.fn();
      subscribe(listener);

      window.dispatchEvent(
        new StorageEvent("storage", { key: "rentify-theme" }),
      );

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("tracking preference", () => {
    it("defaults to enabled", () => {
      expect(isTrackingEnabled()).toBe(true);
      expect(getTrackingServerSnapshot()).toBe(true);
    });

    it("round-trips an opt-out", () => {
      setTrackingEnabled(false);

      expect(window.localStorage.getItem(TRACKING_KEY)).toBe("false");
      expect(isTrackingEnabled()).toBe(false);

      setTrackingEnabled(true);

      expect(isTrackingEnabled()).toBe(true);
    });

    it("notifies subscribers so the store stays in step", () => {
      const listener = vi.fn();
      subscribe(listener);

      setTrackingEnabled(false);

      expect(listener).toHaveBeenCalled();
    });

    it("stays enabled when storage cannot be read", () => {
      const getItem = vi
        .spyOn(window.localStorage, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      expect(isTrackingEnabled()).toBe(true);

      getItem.mockRestore();
    });

    it("does not throw when the preference cannot be written", () => {
      const setItem = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("quota exceeded");
        });

      expect(() => setTrackingEnabled(false)).not.toThrow();

      setItem.mockRestore();
    });
  });
});
