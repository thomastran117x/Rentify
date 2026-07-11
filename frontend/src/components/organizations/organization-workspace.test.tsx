import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationWorkspace } from "./organization-workspace";
import { ApiNetworkError } from "@/lib/api/types";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  setSessionMock,
  showErrorMock,
  getMineMock,
  getByIdMock,
  setActiveMock,
  createMock,
  createInviteMock,
  refreshMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  setSessionMock: vi.fn(),
  showErrorMock: vi.fn(),
  getMineMock: vi.fn(),
  getByIdMock: vi.fn(),
  setActiveMock: vi.fn(),
  createMock: vi.fn(),
  createInviteMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/components/errors", () => ({
  FormErrorMessage: ({
    title,
    message,
  }: {
    title?: string;
    message?: string;
  }) => (
    <div>
      {title ? <p>{title}</p> : null}
      {message ? <p>{message}</p> : null}
    </div>
  ),
  useErrorToast: () => ({
    showError: showErrorMock,
  }),
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    refresh: refreshMock,
  },
}));

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    getMine: getMineMock,
    getById: getByIdMock,
    setActive: setActiveMock,
    create: createMock,
    rename: vi.fn(),
    createInvite: createInviteMock,
    revokeInvite: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));

const workspacePayload = {
  memberships: [
    {
      membershipId: "membership-1",
      id: "org-1",
      name: "Northwind",
      role: "primary_manager" as const,
      joinedAt: "2026-05-01T00:00:00.000Z",
      isActive: true,
    },
  ],
  activeOrganization: {
    id: "org-1",
    name: "Northwind",
    role: "primary_manager" as const,
  },
};

const detailPayload = {
  organization: {
    id: "org-1",
    name: "Northwind",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  },
  viewerRole: "primary_manager" as const,
  members: [
    {
      membershipId: "membership-1",
      userId: "user-1",
      email: "owner@example.com",
      username: "owner-one",
      role: "primary_manager" as const,
      joinedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  invitations: [],
};

describe("OrganizationWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: setSessionMock,
      session: {
        accessToken: "access-token",
        user: {
          id: "user-1",
          email: "owner@example.com",
          username: "owner-one",
          role: "owner",
          organizationMembershipCount: 1,
          activeOrganization: {
            id: "org-1",
            name: "Northwind",
            role: "primary_manager",
          },
        },
      },
    });
    getMineMock.mockResolvedValue(workspacePayload);
    getByIdMock.mockResolvedValue(detailPayload);
    setActiveMock.mockResolvedValue({
      activeOrganization: workspacePayload.activeOrganization,
    });
    createMock.mockResolvedValue({
      organization: {
        id: "org-2",
        name: "Acme Rentals",
        role: "primary_manager",
      },
      membership: {
        membershipId: "membership-2",
        id: "org-2",
        name: "Acme Rentals",
        role: "primary_manager",
        joinedAt: "2026-06-01T00:00:00.000Z",
        isActive: true,
      },
    });
    refreshMock.mockResolvedValue(null);
    createInviteMock.mockResolvedValue({
      invitation: {
        id: "invite-1",
      },
    });
  });

  it("redirects anonymous visitors to login", async () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
    });

    render(<OrganizationWorkspace />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/login?next=/organizations",
      );
    });
  });

  it("loads the active organization detail and allows inviting teammates", async () => {
    const user = userEvent.setup();

    render(<OrganizationWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Northwind" }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("teammate@example.com"),
      "teammate@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => {
      expect(createInviteMock).toHaveBeenCalledWith("org-1", {
        email: "teammate@example.com",
        role: "operator",
      });
    });
  });

  it("shows the create form when the authenticated user has no memberships", async () => {
    getMineMock.mockResolvedValue({
      memberships: [],
    });

    render(<OrganizationWorkspace />);

    expect(
      await screen.findByText("Create your first organization"),
    ).toBeInTheDocument();
  });

  it("creates an organization from the empty state", async () => {
    const user = userEvent.setup();
    getMineMock.mockResolvedValueOnce({ memberships: [] });
    const refreshedSession = { accessToken: "next", user: { id: "user-1" } };
    refreshMock.mockResolvedValue(refreshedSession);

    render(<OrganizationWorkspace />);

    await user.type(
      await screen.findByLabelText("Organization name"),
      "Acme Rentals",
    );
    await user.click(
      screen.getByRole("button", { name: "Create organization" }),
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({ name: "Acme Rentals" });
    });
    expect(refreshMock).toHaveBeenCalled();
    expect(setSessionMock).toHaveBeenCalledWith(refreshedSession);
  });

  it("routes invite failures through the global error toast", async () => {
    const user = userEvent.setup();
    createInviteMock.mockRejectedValue(
      new ApiNetworkError("Unable to reach the server.", {
        code: "NETWORK_ERROR",
        request: {
          method: "POST",
          path: "/organizations/org-1/invitations",
          requestUrl:
            "http://localhost:8040/api/v1/organizations/org-1/invitations",
        },
      }),
    );

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.type(
      screen.getByPlaceholderText("teammate@example.com"),
      "teammate@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith({
        title: "Couldn't send invitation",
        message:
          "We couldn't send that invitation because we couldn't reach Rentify. Check your connection and try again.",
        tone: "error",
      });
      expect(screen.getByText("Couldn't send invitation")).toBeInTheDocument();
      expect(
        screen.getByText(
          "We couldn't send that invitation because we couldn't reach Rentify. Check your connection and try again.",
        ),
      ).toBeInTheDocument();
    });
  });
});
