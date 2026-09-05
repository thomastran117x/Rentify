import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";

const { snapshotMock, writeMock, clearMock, clearHintMock } = vi.hoisted(
  () => ({
    snapshotMock: vi.fn(),
    writeMock: vi.fn(),
    clearMock: vi.fn(),
    clearHintMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/storage", () => ({
  getStoredSessionSnapshot: snapshotMock,
  subscribeToStoredSession: () => () => undefined,
  writeStoredSession: writeMock,
  clearStoredSession: clearMock,
  clearAuthActiveHint: clearHintMock,
}));
vi.mock("@/components/auth/session-manager", () => ({
  SessionManager: ({ onComplete }: { onComplete: () => void }) => (
    <button type="button" onClick={onComplete}>
      Finish restore
    </button>
  ),
}));

function Consumer() {
  const { status, session, setSession, clearSession } = useAuth();
  return (
    <>
      <p>Status: {status}</p>
      <p>Email: {session?.user.email ?? "none"}</p>
      <button
        type="button"
        onClick={() =>
          setSession({
            accessToken: "a",
            refreshToken: "r",
            user: { email: "new@example.com" },
          } as never)
        }
      >
        Set
      </button>
      <button type="button" onClick={clearSession}>
        Clear
      </button>
    </>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts loading and then exposes an anonymous session", async () => {
    snapshotMock.mockReturnValue(null);
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    expect(screen.getByText("Status: loading")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish restore" }));
    expect(screen.getByText("Status: anonymous")).toBeInTheDocument();
  });

  it("exposes authenticated sessions and persists context actions", async () => {
    snapshotMock.mockReturnValue({ user: { email: "person@example.com" } });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Finish restore" }));
    expect(screen.getByText("Status: authenticated")).toBeInTheDocument();
    expect(screen.getByText("Email: person@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(writeMock).toHaveBeenCalledOnce();
    expect(clearMock).toHaveBeenCalledOnce();
  });

  it("rejects useAuth outside its provider", () => {
    expect(() => render(<Consumer />)).toThrow(
      "useAuth must be used within an AuthProvider.",
    );
  });

  // The refresh cookie can lapse while the app is closed, so no refresh runs
  // and nothing else would retire the pre-paint sidebar marker — leaving every
  // later visit to reserve the rail and then drop it.
  it("retires the pre-paint auth marker once restoration resolves anonymous", async () => {
    snapshotMock.mockReturnValue(null);
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(clearHintMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Finish restore" }));

    expect(screen.getByText("Status: anonymous")).toBeInTheDocument();
    expect(clearHintMock).toHaveBeenCalled();
  });

  it("keeps the marker when restoration resolves authenticated", async () => {
    snapshotMock.mockReturnValue({
      accessToken: "a",
      user: { email: "person@example.com" },
    });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Finish restore" }));

    expect(screen.getByText("Status: authenticated")).toBeInTheDocument();
    expect(clearHintMock).not.toHaveBeenCalled();
  });
});
