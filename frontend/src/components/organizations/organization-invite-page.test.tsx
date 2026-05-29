import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationInvitePage } from "./organization-invite-page";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  previewInviteMock,
  acceptInviteMock,
  refreshMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  previewInviteMock: vi.fn(),
  acceptInviteMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    refresh: refreshMock,
  },
}));

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    previewInvite: previewInviteMock,
    acceptInvite: acceptInviteMock,
  },
}));

const previewPayload = {
  invitation: {
    organizationId: "org-1",
    organizationName: "Northwind",
    emailHint: "t***@example.com",
    role: "operator" as const,
    status: "pending" as const,
    expiresAt: "2026-06-04T00:00:00.000Z",
  },
  viewer: {
    authenticated: false,
    matchesEmail: false,
    canAccept: false,
  },
};

describe("OrganizationInvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    previewInviteMock.mockResolvedValue(previewPayload);
    acceptInviteMock.mockResolvedValue({
      accepted: true,
      organization: {
        id: "org-1",
        name: "Northwind",
        role: "operator",
      },
      membership: {
        membershipId: "membership-1",
        id: "org-1",
        name: "Northwind",
        role: "operator",
        joinedAt: "2026-05-28T00:00:00.000Z",
        isActive: true,
      },
    });
    refreshMock.mockResolvedValue({
      accessToken: "access-token",
      user: {
        id: "user-2",
        email: "teammate@example.com",
        username: "teammate",
        role: "user",
        organizationMembershipCount: 1,
        activeOrganization: {
          id: "org-1",
          name: "Northwind",
          role: "operator",
        },
      },
    });
  });

  it("guides anonymous users to sign in or sign up with the invite redirect", async () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
      setSession: vi.fn(),
    });

    render(<OrganizationInvitePage token="token-123" />);

    expect(
      await screen.findByRole("heading", { name: "Join Northwind" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?next=%2Forganizations%2Finvitations%2Ftoken-123",
    );
    expect(
      screen.getByRole("link", { name: "Create account" }),
    ).toHaveAttribute(
      "href",
      "/signup?next=%2Forganizations%2Finvitations%2Ftoken-123",
    );
  });

  it("accepts the invite for a matching verified viewer and redirects", async () => {
    const user = userEvent.setup();
    const setSession = vi.fn();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "teammate@example.com",
        },
      },
      setSession,
    });
    previewInviteMock.mockResolvedValue({
      ...previewPayload,
      viewer: {
        authenticated: true,
        email: "teammate@example.com",
        emailVerified: true,
        matchesEmail: true,
        canAccept: true,
      },
    });

    render(<OrganizationInvitePage token="token-123" />);

    await user.click(
      await screen.findByRole("button", { name: "Accept invitation" }),
    );

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith("token-123");
    });
    expect(refreshMock).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/organizations");
  });

  it("shows the mismatched email warning for signed-in viewers", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: {
        user: {
          email: "different@example.com",
        },
      },
      setSession: vi.fn(),
    });
    previewInviteMock.mockResolvedValue({
      ...previewPayload,
      viewer: {
        authenticated: true,
        email: "different@example.com",
        emailVerified: true,
        matchesEmail: false,
        canAccept: false,
      },
    });

    render(<OrganizationInvitePage token="token-123" />);

    expect(
      await screen.findByText(
        "This invite was sent to a different email address. Sign in with the invited email to continue.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Accept invitation" }),
    ).toBeDisabled();
  });
});
