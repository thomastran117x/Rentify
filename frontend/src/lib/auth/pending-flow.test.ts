import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedAuthPendingFlow,
  clearPersistedAuthPendingFlowByType,
  readPersistedAuthPendingFlow,
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
});
