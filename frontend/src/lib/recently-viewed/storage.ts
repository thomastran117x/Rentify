/**
 * The browser's own copy of the recently viewed list.
 *
 * This is the only store a signed-out visitor has, and for a signed-in one it
 * is a mirror that lets the rows paint on the first frame with no request. It
 * is never cleared on sign-in: signing out must not vaporise the list, and a
 * failed sync would otherwise be data loss.
 *
 * The mirror also remembers which account, if any, it currently reflects (see
 * `owner` below). That is what keeps one account's browsing from leaking into
 * a different identity that later uses the same browser -- see
 * `reconcileIdentity`.
 *
 * Modelled on `@/lib/theme/use-theme` -- a module-level listener set plus a
 * cached snapshot, read through `useSyncExternalStore`.
 */

const STORAGE_KEY = "rentify.recently-viewed.v2";
const TRACKING_KEY = "rentify.recently-viewed.enabled";

/** Matches the server's per-account cap, so the mirror cannot outgrow it. */
export const RECENTLY_VIEWED_LOCAL_CAP = 50;

const STORAGE_VERSION = 2;

export interface RecentlyViewedEntry {
  /** Posting identifier. */
  id: string;
  /** When it was viewed, epoch milliseconds. */
  at: number;
}

/**
 * The mirror as stored: the entries, plus who they currently belong to.
 *
 * `owner: null` means the mirror has never been confirmed against a specific
 * signed-in account -- either genuinely fresh anonymous browsing, or a mirror
 * that was just reset because a different identity took over this browser.
 * `owner: <userId>` means the mirror was last read from or synced to that
 * account, and it is trusted only for that account from then on.
 */
export interface RecentlyViewedMirror {
  entries: readonly RecentlyViewedEntry[];
  owner: string | null;
}

/**
 * The empty, unclaimed mirror, as a single frozen instance.
 *
 * Identity matters more than the value here: `useSyncExternalStore` compares
 * snapshots by reference and re-renders forever if a getter allocates. This is
 * both the server snapshot and the value every failed read falls back to.
 */
const EMPTY_ENTRIES: readonly RecentlyViewedEntry[] = Object.freeze([]);
const EMPTY_MIRROR: RecentlyViewedMirror = Object.freeze({
  entries: EMPTY_ENTRIES,
  owner: null,
});

const listeners = new Set<() => void>();

let cache: RecentlyViewedMirror | null = null;
let storageListenerAttached = false;

function canUseDom(): boolean {
  return typeof window !== "undefined";
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function isEntry(value: unknown): value is RecentlyViewedEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<RecentlyViewedEntry>;

  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at)
  );
}

/**
 * Reads and repairs what is in storage. Anything unparseable, of the wrong
 * version, or not shaped like a mirror is treated as absent rather than
 * thrown, so a bad write from an older build cannot break the page.
 *
 * The version bump that introduced `owner` is deliberate here: silently
 * discarding a pre-fix mirror (which carried no ownership information at all)
 * is the safest remediation for anyone who was already affected by the
 * cross-account leak this file now guards against.
 */
function read(): RecentlyViewedMirror {
  if (!canUseDom()) {
    return EMPTY_MIRROR;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return EMPTY_MIRROR;
    }

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== STORAGE_VERSION ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return EMPTY_MIRROR;
    }

    const rawOwner = (parsed as { owner?: unknown }).owner;
    const owner = typeof rawOwner === "string" ? rawOwner : null;
    const entries = (parsed as { entries: unknown[] }).entries.filter(isEntry);

    if (entries.length === 0 && owner === null) {
      return EMPTY_MIRROR;
    }

    return Object.freeze({
      entries: Object.freeze(entries.slice(0, RECENTLY_VIEWED_LOCAL_CAP)),
      owner,
    });
  } catch {
    // Private mode, disabled storage, or corrupt JSON.
    return EMPTY_MIRROR;
  }
}

function write(mirror: RecentlyViewedMirror): void {
  if (!canUseDom()) {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: STORAGE_VERSION,
        owner: mirror.owner,
        entries: mirror.entries,
      }),
    );
  } catch {
    // Ignore storage failures (private mode, quota, disabled). The in-memory
    // cache still reflects the change for this page view.
  }
}

function commit(mirror: RecentlyViewedMirror): void {
  const next =
    mirror.entries.length > 0 || mirror.owner !== null
      ? Object.freeze({ entries: mirror.entries, owner: mirror.owner })
      : EMPTY_MIRROR;

  cache = next;
  write(next);
  notify();
}

function currentMirror(): RecentlyViewedMirror {
  if (cache === null) {
    cache = read();
  }

  return cache;
}

/** Newest first, one entry per posting, capped. */
function normalize(
  entries: readonly RecentlyViewedEntry[],
): readonly RecentlyViewedEntry[] {
  const latestById = new Map<string, number>();

  for (const entry of entries) {
    const existing = latestById.get(entry.id);

    if (existing === undefined || entry.at > existing) {
      latestById.set(entry.id, entry.at);
    }
  }

  return Array.from(latestById, ([id, at]) => ({ id, at }))
    .sort(
      (left, right) => right.at - left.at || left.id.localeCompare(right.id),
    )
    .slice(0, RECENTLY_VIEWED_LOCAL_CAP);
}

export function getSnapshot(): readonly RecentlyViewedEntry[] {
  return currentMirror().entries;
}

/**
 * Always the same frozen empty list, so the server render and the first client
 * render agree and hydration stays stable. The real value arrives on the next
 * commit, after mount.
 */
export function getServerSnapshot(): readonly RecentlyViewedEntry[] {
  return EMPTY_ENTRIES;
}

/** The account this mirror currently reflects, or null if unclaimed. */
export function getOwner(): string | null {
  return currentMirror().owner;
}

export function getOwnerServerSnapshot(): string | null {
  return null;
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  // Attached lazily, and only once, so a page that never reads the list pays
  // nothing. Another tab writing invalidates this tab's cache.
  if (canUseDom() && !storageListenerAttached) {
    storageListenerAttached = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== STORAGE_KEY) {
        return;
      }

      cache = null;
      notify();
    });
  }

  return () => {
    listeners.delete(onChange);
  };
}

/** Moves a posting to the front, or adds it. Preserves the current owner. */
export function recordView(postingId: string, at: number = Date.now()): void {
  const current = currentMirror();

  commit({
    owner: current.owner,
    entries: normalize([{ id: postingId, at }, ...current.entries]),
  });
}

export function removeEntry(postingId: string): void {
  const current = currentMirror();
  const next = current.entries.filter((entry) => entry.id !== postingId);

  if (next.length !== current.entries.length) {
    commit({ owner: current.owner, entries: next });
  }
}

export function clearAll(): void {
  const current = currentMirror();

  commit({ owner: current.owner, entries: EMPTY_ENTRIES });
}

/**
 * Adopts the server's answer as the given account's mirror. This is the only
 * place `owner` is set to a specific account, and it always replaces the
 * entries outright -- so a foreign owner's leftover local entries never
 * survive a different account signing in, even if `reconcileIdentity` was
 * somehow skipped.
 */
export function adoptForAccount(
  userId: string,
  entries: readonly RecentlyViewedEntry[],
): void {
  commit({ owner: userId, entries: normalize(entries) });
}

/**
 * Adopts a pruned entry list without changing who owns the mirror. Used only
 * while hydrating a genuinely unclaimed (anonymous) mirror against the public
 * batch endpoint, where entries can drop out (gone postings) but ownership
 * never changes.
 */
export function replaceAll(entries: readonly RecentlyViewedEntry[]): void {
  const current = currentMirror();

  commit({ owner: current.owner, entries: normalize(entries) });
}

/**
 * Called whenever the identity using this browser might have changed --
 * effectively, on every auth resolution. `identity` is the signed-in
 * account's id, or null while anonymous.
 *
 * If the mirror was last claimed by a *different* specific account, it is
 * reset to a fresh, unclaimed mirror before anything else touches it. That
 * previous owner's history is not lost: the account itself is the source of
 * truth, and this local copy was only ever a staging area for browsing not
 * yet synced. But it must never be displayed to, or uploaded from, a
 * different identity that goes on to use the same browser -- whether that
 * identity is a different account or an anonymous visitor. This is what
 * stops one account's confirmed history from being synced into another's on
 * a shared device: after a mismatch, there is nothing local left to sync.
 *
 * A mirror that is already unclaimed (`owner === null`) or already belongs to
 * `identity` is left untouched, so genuine anonymous browsing still merges
 * into whichever account signs in for it first.
 */
export function reconcileIdentity(identity: string | null): void {
  const current = currentMirror();

  if (current.owner !== null && current.owner !== identity) {
    commit(EMPTY_MIRROR);
  }
}

/**
 * Whether this browser should record views.
 *
 * Signed-in callers have this on their profile and the server enforces it; the
 * local copy is what gives a signed-out visitor the same off switch, and what
 * stops a signed-in one building a local history the server would refuse.
 */
export function isTrackingEnabled(): boolean {
  if (!canUseDom()) {
    return true;
  }

  try {
    return window.localStorage.getItem(TRACKING_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setTrackingEnabled(enabled: boolean): void {
  if (!canUseDom()) {
    return;
  }

  try {
    window.localStorage.setItem(TRACKING_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures; the server remains the authority for accounts.
  }

  notify();
}

/** Test seam: drops the cached snapshot so the next read hits storage. */
export function resetCacheForTests(): void {
  cache = null;
}

/**
 * Server snapshot for the tracking preference. Permissive by default, matching
 * the column default, and a module-level function so the identity is stable.
 */
export function getTrackingServerSnapshot(): boolean {
  return true;
}
