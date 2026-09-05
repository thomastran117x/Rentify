import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredAuthSession } from "@/lib/auth/types";
import {
  clearStoredSession,
  getStoredSessionSnapshot,
  readStoredSession,
  subscribeToStoredSession,
  writeStoredSession,
} from "./storage";

const sampleSession: StoredAuthSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  device: {
    deviceId: "device-1",
    known: true,
    knownByIp: false,
  },
  user: {
    id: "user-1",
    email: "person@example.com",
    username: "person",
    role: "user",
  },
};

describe("auth storage", () => {
  beforeEach(() => {
    clearStoredSession();
  });

  it("writes, reads, and clears the in-memory session", () => {
    writeStoredSession(sampleSession);
    expect(readStoredSession()).toEqual(sampleSession);
    expect(getStoredSessionSnapshot()).toEqual(sampleSession);

    clearStoredSession();
    expect(readStoredSession()).toBeNull();
    expect(getStoredSessionSnapshot()).toBeNull();
  });

  // The root layout reads this before first paint to decide whether the app
  // shell reserves its sidebar. The session itself stays in memory and is
  // restored through the refresh cookie, so without this marker the rail can
  // only appear after that round-trip — shifting content that is already
  // painted.
  it("records and clears a non-sensitive active-session hint", () => {
    writeStoredSession(sampleSession);
    expect(window.localStorage.getItem("rentify.auth.active")).toBe("1");

    clearStoredSession();
    expect(window.localStorage.getItem("rentify.auth.active")).toBeNull();
  });

  it("never persists the session itself", () => {
    writeStoredSession(sampleSession);

    const persisted = Object.keys(window.localStorage)
      .map((key) => window.localStorage.getItem(key) ?? "")
      .join(" ");
    expect(persisted).not.toContain("access-token");
    expect(persisted).not.toContain("refresh-token");
    expect(window.localStorage.getItem("rentify.auth.session")).toBeNull();
  });

  it("notifies subscribers for local writes and storage events", () => {
    const onStoreChange = vi.fn();
    const unsubscribe = subscribeToStoredSession(onStoreChange);

    writeStoredSession(sampleSession);
    expect(onStoreChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "rentify.auth.signal",
      }),
    );
    expect(onStoreChange).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
