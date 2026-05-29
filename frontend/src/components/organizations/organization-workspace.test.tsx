import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationWorkspace } from "./organization-workspace";
import {
  resetRouterMocks,
  routerReplaceMock,
} from "@/test/mocks/next-navigation";

const {
  useAuthMock,
  getMineMock,
  getByIdMock,
  setActiveMock,
  createInviteMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getMineMock: vi.fn(),
  getByIdMock: vi.fn(),
  setActiveMock: vi.fn(),
  createInviteMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    getMine: getMineMock,
    getById: getByIdMock,
    setActive: setActiveMock,
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

  it("shows the empty state when the authenticated user has no memberships", async () => {
    getMineMock.mockResolvedValue({
      memberships: [],
    });

    render(<OrganizationWorkspace />);

    expect(
      await screen.findByText("No organization access yet"),
    ).toBeInTheDocument();
  });
});
