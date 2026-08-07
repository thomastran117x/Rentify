import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "./page";

const {
  useAuthMock,
  linkedProvidersMock,
  listTokensMock,
  getMineMock,
  updateMineMock,
  getOptionsMock,
  listDevicesMock,
  createTokenMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  linkedProvidersMock: vi.fn(),
  listTokensMock: vi.fn(),
  getMineMock: vi.fn(),
  updateMineMock: vi.fn(),
  getOptionsMock: vi.fn(),
  listDevicesMock: vi.fn(),
  createTokenMock: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("@/components/auth/oauth-buttons", () => ({ AuthOAuthButtons: () => <div>OAuth buttons</div> }));
vi.mock("@/components/auth/mfa-verification-dialog", () => ({ MfaVerificationDialog: () => null }));
vi.mock("@/components/home/home-mfa-totp-panel", () => ({ HomeMfaTotpPanel: () => <div>MFA panel</div> }));
vi.mock("@/components/home/home-password-panel", () => ({ HomePasswordPanel: () => <div>Password panel</div> }));
vi.mock("@/lib/auth/api", () => ({
  authApi: {
    linkedOAuthProviders: linkedProvidersMock,
    listPersonalAccessTokens: listTokensMock,
    listKnownDevices: listDevicesMock,
    createPersonalAccessToken: createTokenMock,
    unlinkOAuthProvider: vi.fn(),
    removeKnownDevice: vi.fn(),
    revokePersonalAccessToken: vi.fn(),
  },
}));
vi.mock("@/lib/profiles/api", () => ({
  profilesApi: { getMine: getMineMock, updateMine: updateMineMock },
}));
vi.mock("@/lib/auth/mfa-verification-api", () => ({
  mfaVerificationApi: { getOptions: getOptionsMock },
}));

const profile = {
  username: "renter-one",
  phoneNumber: null,
  isPrivate: false,
  recommendationPersonalizationEnabled: true,
};

function authenticated(): void {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session: { user: { email: "renter@example.com", role: "user" } },
  });
}

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticated();
    linkedProvidersMock.mockResolvedValue({ hasPassword: true, providers: [] });
    listTokensMock.mockResolvedValue({ tokens: [] });
    getMineMock.mockResolvedValue(profile);
    updateMineMock.mockResolvedValue(profile);
    getOptionsMock.mockResolvedValue({ verified: true, methods: [] });
    listDevicesMock.mockResolvedValue({ devices: [] });
    createTokenMock.mockResolvedValue({
      id: "pat-1", name: "Rentify MCP", token: "secret-token", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: null, revokedAt: null, scopes: ["mcp:read"],
    });
  });

  it("renders loading and anonymous account states", () => {
    useAuthMock.mockReturnValue({ status: "loading", session: null });
    const { rerender } = render(<AccountPage />);
    expect(screen.getByText("Loading account...")).toBeInTheDocument();

    useAuthMock.mockReturnValue({ status: "anonymous", session: null });
    rerender(<AccountPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("loads and saves profile settings", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    const username = await screen.findByPlaceholderText("renter-one");
    expect(username).toHaveValue("renter-one");
    await user.clear(username);
    await user.type(username, "new-name");
    await user.click(screen.getByRole("button", { name: "Advanced settings" }));
    await user.click(screen.getByRole("checkbox", { name: /Private account/ }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(updateMineMock).toHaveBeenCalledWith({
      username: "new-name", isPrivate: true, recommendationPersonalizationEnabled: true,
    }));
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
  });

  it("unlocks security settings after a verified MFA check", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.click(screen.getByRole("button", { name: "Security" }));

    expect(await screen.findByRole("heading", { name: "Password" })).toBeInTheDocument();
    expect(screen.getByText("Password panel")).toBeInTheDocument();
    expect(getOptionsMock).toHaveBeenCalledWith("mfa-management");
    expect(listDevicesMock).toHaveBeenCalledTimes(1);
  });

  it("creates a personal access token from the developer tab", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.click(screen.getByRole("button", { name: "Developer" }));
    const name = await screen.findByRole("textbox", { name: /Token name/ });
    await user.clear(name);
    await user.type(name, "CLI token");
    await user.click(screen.getByRole("button", { name: /Create token/ }));

    await waitFor(() => expect(createTokenMock).toHaveBeenCalledWith({
      name: "CLI token", expiresInDays: 30, scopes: ["mcp:read"],
    }));
    expect(await screen.findByText("secret-token")).toBeInTheDocument();
  });
});
