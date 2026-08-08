import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedAuthPendingFlow,
  clearPersistedAuthPendingFlowByType,
  getPersistedAuthPendingFlowSnapshot,
  parsePendingFlow,
  readPersistedAuthPendingFlow,
  subscribeToPersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "./pending-flow";

describe("pending auth flow storage", () => {
  beforeEach(() => {
    clearPersistedAuthPendingFlow();
  });

  it("writes and reads signup verification state", () => {
    writePersistedAuthPendingFlow({
      flow: "signup-verification",
      email: "person@example.com",
      nextPath: "/dashboard",
      alreadyPending: false,
    });

    expect(readPersistedAuthPendingFlow()).toEqual({
      flow: "signup-verification",
      email: "person@example.com",
      nextPath: "/dashboard",
      alreadyPending: false,
    });
  });

  it("does not emit a storage change for identical state", () => {
    const handleChange = vi.fn();
    const flow = {
      flow: "device-login-mfa" as const,
      nextPath: "/dashboard",
      selectedFactor: "email" as const,
      challengeSent: true,
    };

    window.addEventListener("rentify-auth-pending-flow-storage", handleChange);

    writePersistedAuthPendingFlow(flow);
    handleChange.mockClear();

    writePersistedAuthPendingFlow({ ...flow });

    expect(handleChange).not.toHaveBeenCalled();
    expect(readPersistedAuthPendingFlow()).toEqual(flow);

    window.removeEventListener(
      "rentify-auth-pending-flow-storage",
      handleChange,
    );
  });

  it("clears the stored flow", () => {
    writePersistedAuthPendingFlow({
      flow: "login-unlock",
      email: "person@example.com",
    });

    clearPersistedAuthPendingFlow();

    expect(readPersistedAuthPendingFlow()).toBeNull();
  });

  it("clears only the requested flow type", () => {
    writePersistedAuthPendingFlow({
      flow: "forgot-password-reset",
      username: "person",
    });

    clearPersistedAuthPendingFlowByType("signup-verification");
    expect(readPersistedAuthPendingFlow()).toEqual({
      flow: "forgot-password-reset",
      username: "person",
    });

    clearPersistedAuthPendingFlowByType("forgot-password-reset");
    expect(readPersistedAuthPendingFlow()).toBeNull();
  });

  it("ignores malformed stored state and removes it", () => {
    window.sessionStorage.setItem(
      "rentify.auth.pending-flow",
      JSON.stringify({
        flow: "device-login-mfa",
        selectedFactor: "sms",
      }),
    );

    expect(readPersistedAuthPendingFlow()).toBeNull();
    expect(
      window.sessionStorage.getItem("rentify.auth.pending-flow"),
    ).toBeNull();
  });

  it("removes invalid json payloads", () => {
    window.sessionStorage.setItem("rentify.auth.pending-flow", "{bad json");

    expect(readPersistedAuthPendingFlow()).toBeNull();
    expect(
      window.sessionStorage.getItem("rentify.auth.pending-flow"),
    ).toBeNull();
  });

  it.each([
    [
      {
        flow: "signup-verification",
        email: "person@example.com",
        nextPath: "/account",
        alreadyPending: true,
      },
      "signup-verification",
    ],
    [
      { flow: "forgot-password-reset", username: "person" },
      "forgot-password-reset",
    ],
    [{ flow: "login-unlock", email: "person@example.com" }, "login-unlock"],
    [
      {
        flow: "device-login-mfa",
        nextPath: "/account",
        selectedFactor: "totp",
        challengeSent: false,
      },
      "device-login-mfa",
    ],
  ])("parses each supported flow %#", (value, flow) => {
    expect(parsePendingFlow(value)).toMatchObject({ flow });
  });

  it.each([
    null,
    "signup-verification",
    {},
    { flow: "unknown" },
    {
      flow: "signup-verification",
      email: "",
      nextPath: "/",
      alreadyPending: false,
    },
    {
      flow: "signup-verification",
      email: "a@b.test",
      nextPath: "",
      alreadyPending: false,
    },
    {
      flow: "signup-verification",
      email: "a@b.test",
      nextPath: "/",
      alreadyPending: "no",
    },
    { flow: "forgot-password-reset", username: " " },
    { flow: "login-unlock", email: 42 },
    {
      flow: "device-login-mfa",
      nextPath: "",
      selectedFactor: "email",
      challengeSent: true,
    },
    {
      flow: "device-login-mfa",
      nextPath: "/",
      selectedFactor: "sms",
      challengeSent: true,
    },
    {
      flow: "device-login-mfa",
      nextPath: "/",
      selectedFactor: "email",
      challengeSent: "yes",
    },
  ])("rejects malformed flow %#", (value) => {
    expect(parsePendingFlow(value)).toBeNull();
  });

  it("returns a cached flow and exposes it through the external-store snapshot", () => {
    const flow = {
      flow: "login-unlock" as const,
      email: "cached@example.com",
    };
    writePersistedAuthPendingFlow(flow);

    expect(readPersistedAuthPendingFlow()).toBe(flow);
    expect(getPersistedAuthPendingFlowSnapshot()).toBe(flow);
  });

  it("subscribes to both local and browser storage changes and unsubscribes", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToPersistedAuthPendingFlow(onChange);

    window.dispatchEvent(new Event("storage"));
    writePersistedAuthPendingFlow({
      flow: "login-unlock",
      email: "subscriber@example.com",
    });
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event("storage"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("handles calls when browser storage is unavailable", () => {
    const originalWindow = window;
    vi.stubGlobal("window", undefined);

    expect(readPersistedAuthPendingFlow()).toBeNull();
    expect(getPersistedAuthPendingFlowSnapshot()).toBeUndefined();
    expect(() =>
      writePersistedAuthPendingFlow({
        flow: "login-unlock",
        email: "person@example.com",
      }),
    ).not.toThrow();
    expect(() => clearPersistedAuthPendingFlow()).not.toThrow();
    expect(() => subscribeToPersistedAuthPendingFlow(vi.fn())()).not.toThrow();

    vi.stubGlobal("window", originalWindow);
  });
});
