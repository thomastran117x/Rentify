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
  createUploadUrlMock,
  deleteBlobMock,
  deleteBlobKeepaliveMock,
  usePathnameMock,
  useSearchParamsMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getMineMock: vi.fn(),
  getByIdMock: vi.fn(),
  setActiveMock: vi.fn(),
  createInviteMock: vi.fn(),
  createUploadUrlMock: vi.fn(),
  deleteBlobMock: vi.fn(),
  deleteBlobKeepaliveMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
}));

function setSearchParams(query = "") {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(query));
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
  usePathname: () => usePathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/blob/api", () => ({
  blobApi: {
    createUploadUrl: createUploadUrlMock,
    deleteBlob: deleteBlobMock,
    deleteBlobKeepalive: deleteBlobKeepaliveMock,
  },
}));

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    getMine: getMineMock,
    getById: getByIdMock,
    setActive: setActiveMock,
    rename: vi.fn(),
    update: vi.fn(),
    createInvite: createInviteMock,
    revokeInvite: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    listAudit: vi.fn(async () => ({ auditLogs: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false } })),
    restoreAuditEntry: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    listMine: vi.fn(async () => ({ postings: [] })),
    publish: vi.fn(),
    pausePosting: vi.fn(),
    unpausePosting: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api", () => ({
  authApi: {
    refresh: vi.fn(),
  },
}));

describe("OrganizationWorkspace toast integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    usePathnameMock.mockReturnValue("/organizations");
    setSearchParams("");

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
        description: null,
        websiteUrl: null,
        contactEmail: null,
        contactPhone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        country: null,
        postalCode: null,
        logoUrl: null,
        logoBlobName: null,
        customFields: null,
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
    createUploadUrlMock.mockResolvedValue({
      method: "PUT",
      uploadUrl: "https://upload.test/logo.png",
      expiresAt: "2026-06-30T00:00:00.000Z",
      blobName: "organizations/user-1/logo.png",
      blobUrl: "https://cdn.test/organizations/user-1/logo.png",
      container: "rentify",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "image/png",
      },
    });
    deleteBlobMock.mockResolvedValue(undefined);
    deleteBlobKeepaliveMock.mockImplementation(() => undefined);
    window.sessionStorage.clear();
  });

  it("renders a toast when sending an invite fails from the Team tab", async () => {
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
    await user.click(screen.getByRole("tab", { name: /Team/i }));
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
