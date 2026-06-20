import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorToastProvider } from "@/components/errors";
import { ApiClientError } from "@/lib/api/types";
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

describe("OrganizationWorkspace toast integration", () => {
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

    getMineMock.mockResolvedValue({
      memberships: [
        {
          membershipId: "membership-1",
          id: "org-1",
          name: "Northwind",
          role: "primary_manager",
          joinedAt: "2026-05-01T00:00:00.000Z",
          isActive: true,
        },
      ],
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "primary_manager",
      },
    });

    getByIdMock.mockResolvedValue({
      organization: {
        id: "org-1",
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      viewerRole: "primary_manager",
      members: [
        {
          membershipId: "membership-1",
          userId: "user-1",
          email: "owner@example.com",
          username: "owner-one",
          role: "primary_manager",
          joinedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      invitations: [],
    });

    setActiveMock.mockResolvedValue({
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "primary_manager",
      },
    });
  });

  it("renders a toast when sending an invite fails", async () => {
    const user = userEvent.setup();

    createInviteMock.mockRejectedValue(
      new ApiClientError(
        "That user is already a member of this organization.",
        {
          code: "CONFLICT",
          request: {
            method: "POST",
            path: "/organizations/org-1/invitations",
            requestUrl:
              "http://localhost:8040/api/v1/organizations/org-1/invitations",
          },
          status: 409,
        },
      ),
    );

    render(
      <ErrorToastProvider>
        <OrganizationWorkspace />
      </ErrorToastProvider>,
    );

    await screen.findByRole("heading", { name: "Northwind" });
    await user.type(
      screen.getByPlaceholderText("teammate@example.com"),
      "owner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(2);
      expect(screen.getAllByText("Couldn't send invitation")).toHaveLength(2);
      expect(
        screen.getAllByText(
          "That user is already a member of this organization.",
        ),
      ).toHaveLength(2);
    });
  });
});
