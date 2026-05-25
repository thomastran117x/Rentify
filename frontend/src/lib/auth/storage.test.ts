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
