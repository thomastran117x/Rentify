import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEmailAvailability } from "./use-email-availability";

const { checkEmailAvailabilityMock } = vi.hoisted(() => ({
  checkEmailAvailabilityMock: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    checkEmailAvailability: checkEmailAvailabilityMock,
  },
}));

function available(email: string) {
  return { email, available: true, reason: null };
}

function taken(email: string) {
  return { email, available: false, reason: "taken" as const };
}

function pending(email: string) {
  return {
    email,
    available: true,
    reason: "pending-verification" as const,
  };
}

describe("useEmailAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkEmailAvailabilityMock.mockResolvedValue(available("jane@example.com"));
  });

  it("stays idle and sends nothing for a value that is not an email", async () => {
    const { result } = renderHook(() => useEmailAvailability("jane@"));

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkEmailAvailabilityMock).not.toHaveBeenCalled();
  });

  it("reports an available email silently after the debounce", async () => {
    // No success message on purpose: announcing a free address would turn the
    // field into a readout of which addresses are registered.
    const { result } = renderHook(() =>
      useEmailAvailability("jane@example.com"),
    );

    expect(result.current.status).toBe("checking");

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(result.current.message).toBeNull();
    expect(checkEmailAvailabilityMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports a taken email", async () => {
    checkEmailAvailabilityMock.mockResolvedValue(taken("jane@example.com"));

    const { result } = renderHook(() =>
      useEmailAvailability("jane@example.com"),
    );

    await waitFor(() => expect(result.current.status).toBe("taken"));
    expect(result.current.message).toBe("This email is already in use.");
  });

  it("reports a pending signup without marking it unavailable", async () => {
    // Signup accepts this address, so the hook must not report the state that
    // blocks submission.
    checkEmailAvailabilityMock.mockResolvedValue(pending("jane@example.com"));

    const { result } = renderHook(() =>
      useEmailAvailability("jane@example.com"),
    );

    await waitFor(() => expect(result.current.status).toBe("pending"));
    expect(result.current.message).toContain("already started signing up");
  });

  it("normalizes the value before checking it", async () => {
    const { result } = renderHook(() =>
      useEmailAvailability("  Jane@Example.COM "),
    );

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(checkEmailAvailabilityMock).toHaveBeenCalledWith(
      "jane@example.com",
      expect.anything(),
    );
  });

  it("stays idle for the address the account already holds", async () => {
    const { result } = renderHook(() =>
      useEmailAvailability("jane@example.com", {
        currentEmail: "Jane@Example.com",
      }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkEmailAvailabilityMock).not.toHaveBeenCalled();
  });

  it("sends nothing while checking is disabled", async () => {
    const { result } = renderHook(() =>
      useEmailAvailability("jane@example.com", { enabled: false }),
    );

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(checkEmailAvailabilityMock).not.toHaveBeenCalled();
  });

  it("degrades to a non-blocking error when the check fails", async () => {
    // The backend still enforces uniqueness on submit, so a failed check must
    // never be the reason someone cannot sign up.
    checkEmailAvailabilityMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useEmailAvailability("jane@example.com"),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.message).toBe(
      "We couldn't check that email right now.",
    );
  });

  it("never shows a verdict fetched for an earlier value", async () => {
    // A slow response for what the user typed before must not overwrite the
    // answer for what they have typed now.
    checkEmailAvailabilityMock.mockResolvedValue(taken("first@example.com"));

    const { result, rerender } = renderHook(
      ({ email }: { email: string }) => useEmailAvailability(email),
      { initialProps: { email: "first@example.com" } },
    );

    await waitFor(() => expect(result.current.status).toBe("taken"));

    checkEmailAvailabilityMock.mockResolvedValue(
      available("second@example.com"),
    );
    rerender({ email: "second@example.com" });

    expect(result.current.status).toBe("checking");
    await waitFor(() => expect(result.current.status).toBe("available"));
  });
});
