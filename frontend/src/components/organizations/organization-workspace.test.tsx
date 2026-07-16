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
  getWorkspaceByIdMock,
  setActiveMock,
  createMock,
  updateMock,
  createInviteMock,
  listAuditMock,
  restoreAuditEntryMock,
  refreshMock,
  listMinePostingsMock,
  publishPostingMock,
  pausePostingMock,
  unpausePostingMock,
  archivePostingMock,
  revokeInviteMock,
  updateMemberRoleMock,
  removeMemberMock,
  createUploadUrlMock,
  deleteBlobMock,
  deleteBlobKeepaliveMock,
  usePathnameMock,
  useSearchParamsMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  setSessionMock: vi.fn(),
  showErrorMock: vi.fn(),
  getMineMock: vi.fn(),
  getWorkspaceByIdMock: vi.fn(),
  setActiveMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  createInviteMock: vi.fn(),
  listAuditMock: vi.fn(),
  restoreAuditEntryMock: vi.fn(),
  refreshMock: vi.fn(),
  listMinePostingsMock: vi.fn(),
  publishPostingMock: vi.fn(),
  pausePostingMock: vi.fn(),
  unpausePostingMock: vi.fn(),
  archivePostingMock: vi.fn(),
  revokeInviteMock: vi.fn(),
  updateMemberRoleMock: vi.fn(),
  removeMemberMock: vi.fn(),
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

vi.mock("@/lib/blob/api", () => ({
  blobApi: {
    createUploadUrl: createUploadUrlMock,
    deleteBlob: deleteBlobMock,
    deleteBlobKeepalive: deleteBlobKeepaliveMock,
  },
}));

vi.mock("@/lib/postings/api", () => ({
  postingsApi: {
    listMine: listMinePostingsMock,
    publish: publishPostingMock,
    pausePosting: pausePostingMock,
    unpausePosting: unpausePostingMock,
    archive: archivePostingMock,
  },
}));

vi.mock("@/lib/organizations/api", () => ({
  organizationsApi: {
    getMine: getMineMock,
    getWorkspaceById: getWorkspaceByIdMock,
    setActive: setActiveMock,
    create: createMock,
    rename: vi.fn(),
    update: updateMock,
    createInvite: createInviteMock,
    listAudit: listAuditMock,
    restoreAuditEntry: restoreAuditEntryMock,
    revokeInvite: revokeInviteMock,
    updateMemberRole: updateMemberRoleMock,
    removeMember: removeMemberMock,
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

function buildSession(
  role: "primary_manager" | "manager" | "operator" = "primary_manager",
) {
  return {
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
        role,
      },
    },
  };
}

function buildBlobTarget(blobName: string) {
  return {
    method: "PUT" as const,
    uploadUrl: `https://upload.test/${blobName}`,
    expiresAt: "2026-06-30T00:00:00.000Z",
    blobName,
    blobUrl: `https://cdn.test/${blobName}`,
    container: "rentify",
    headers: {
      "x-ms-blob-type": "BlockBlob" as const,
      "Content-Type": "image/png",
    },
  };
}

function buildDetailPayload(
  role: "primary_manager" | "manager" | "operator" = "primary_manager",
) {
  return {
    organization: {
      id: "org-1",
      name: "Northwind",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      description: "Boutique furnished rentals for small creative teams.",
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
    viewerRole: role,
    members: [
      {
        membershipId: "membership-1",
        userId: "user-1",
        email: "owner@example.com",
        username: "owner-one",
        role: "primary_manager" as const,
        joinedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        membershipId: "membership-2",
        userId: "user-2",
        email: "user2@example.com",
        username: "ops-two",
        role: "operator" as const,
        joinedAt: "2026-05-03T00:00:00.000Z",
      },
    ],
    invitations: [
      {
        id: "invite-1",
        email: "pending@example.com",
        emailHint: "p***@example.com",
        role: "operator" as const,
        status: "pending" as const,
        expiresAt: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
        invitedBy: {
          id: "user-1",
          email: "owner@example.com",
          username: "owner-one",
        },
      },
    ],
  };
}

describe("OrganizationWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    usePathnameMock.mockReturnValue("/dashboard/organizations");
    setSearchParams("");
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: setSessionMock,
      session: buildSession(),
    });
    getMineMock.mockResolvedValue(workspacePayload);
    getWorkspaceByIdMock.mockResolvedValue(buildDetailPayload());
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
    updateMock.mockResolvedValue({
      id: "org-1",
      name: "Northwind",
      role: "primary_manager",
    });
    refreshMock.mockResolvedValue(null);
    listMinePostingsMock.mockResolvedValue({ postings: [] });
    createInviteMock.mockResolvedValue({ invitation: { id: "invite-1" } });
    listAuditMock.mockResolvedValue({
      auditLogs: [],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    restoreAuditEntryMock.mockResolvedValue({
      restored: true,
      auditLog: { id: "audit-restore" },
    });
    createUploadUrlMock.mockResolvedValue(
      buildBlobTarget("organizations/user-1/logo-default.png"),
    );
    deleteBlobMock.mockResolvedValue(undefined);
    deleteBlobKeepaliveMock.mockImplementation(() => undefined);
    window.sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 201 })) as unknown as typeof fetch,
    );
  });

  it("redirects anonymous visitors to login", async () => {
    useAuthMock.mockReturnValue({
      status: "anonymous",
      session: null,
    });

    render(<OrganizationWorkspace />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/login?next=/dashboard/organizations",
      );
    });
  });

  it("defaults to the overview tab", async () => {
    render(<OrganizationWorkspace />);

    expect(
      await screen.findByRole("heading", { name: "Northwind" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Overview/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText("Jump to the work that matters"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Invite teammates")).not.toBeInTheDocument();
  });

  it("switches panels when a tab is clicked", async () => {
    const user = userEvent.setup();

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Team/i }));

    expect(screen.getByText("Invite teammates")).toBeInTheDocument();
    expect(routerReplaceMock).toHaveBeenLastCalledWith(
      "/dashboard/organizations?tab=team",
      { scroll: false },
    );
  });

  it("falls back to the first allowed tab when the query tab is unauthorized", async () => {
    setSearchParams("tab=settings");
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: setSessionMock,
      session: buildSession("manager"),
    });
    getMineMock.mockResolvedValue({
      memberships: [
        {
          ...workspacePayload.memberships[0],
          role: "manager",
        },
      ],
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "manager" as const,
      },
    });
    getWorkspaceByIdMock.mockResolvedValue(buildDetailPayload("manager"));

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    expect(
      screen.getByText("Jump to the work that matters"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Settings/i }),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenLastCalledWith(
        "/dashboard/organizations?tab=overview",
        { scroll: false },
      );
    });
  });

  it("sends invites from the Team tab", async () => {
    const user = userEvent.setup();

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Team/i }));
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

  it("publishes a posting from the Postings tab", async () => {
    const user = userEvent.setup();
    listMinePostingsMock.mockResolvedValue({
      postings: [
        {
          id: "posting-1",
          organizationId: "org-1",
          status: "draft",
          name: "Draft loft",
          variant: { family: "place", subtype: "workspace" },
          location: { city: "Toronto", region: "Ontario" },
        },
      ],
    });

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Postings/i }));
    await user.click(await screen.findByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishPostingMock).toHaveBeenCalledWith("posting-1");
    });
  });

  it("restores a restorable audit entry from the Activity tab", async () => {
    const user = userEvent.setup();
    listAuditMock.mockResolvedValue({
      auditLogs: [
        {
          id: "audit-1",
          organizationId: "org-1",
          actor: {
            id: "user-1",
            email: "owner@example.com",
            username: "owner-one",
          },
          action: "organization.renamed",
          resourceType: "organization",
          resourceId: "org-1",
          organizationVersion: 2,
          summary: "Organization renamed from Old Name to Northwind.",
          changes: [{ field: "name", before: "Old Name", after: "Northwind" }],
          restorable: true,
          createdAt: "2026-05-02T00:00:00.000Z",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Activity/i }));
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(restoreAuditEntryMock).toHaveBeenCalledWith("org-1", "audit-1");
    });
  });

  it("cleans up an earlier staged logo when it is replaced before saving", async () => {
    const user = userEvent.setup();
    createUploadUrlMock
      .mockResolvedValueOnce(
        buildBlobTarget("organizations/user-1/logo-first.png"),
      )
      .mockResolvedValueOnce(
        buildBlobTarget("organizations/user-1/logo-second.png"),
      );

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Settings/i }));
    const input = screen.getByLabelText("Upload organization logo");
    await user.upload(
      input,
      new File(["first"], "first.png", { type: "image/png" }),
    );
    await user.upload(
      input,
      new File(["second"], "second.png", { type: "image/png" }),
    );

    await waitFor(() => {
      expect(deleteBlobMock).toHaveBeenCalledWith(
        "organizations/user-1/logo-first.png",
      );
    });
  });

  it("retries staged logo cleanup on the next page load", async () => {
    window.sessionStorage.setItem(
      "organization-workspace:staged-logo-blobs:user-1",
      JSON.stringify(["organizations/user-1/logo-stale.png"]),
    );

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });

    await waitFor(() => {
      expect(deleteBlobMock).toHaveBeenCalledWith(
        "organizations/user-1/logo-stale.png",
      );
    });
    await waitFor(() => {
      expect(
        window.sessionStorage.getItem(
          "organization-workspace:staged-logo-blobs:user-1",
        ),
      ).toBeNull();
    });
  });

  it("attempts keepalive cleanup when a staged logo is abandoned", async () => {
    const user = userEvent.setup();
    createUploadUrlMock.mockResolvedValueOnce(
      buildBlobTarget("organizations/user-1/logo-pending.png"),
    );

    const { unmount } = render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Settings/i }));
    await user.upload(
      screen.getByLabelText("Upload organization logo"),
      new File(["pending"], "pending.png", { type: "image/png" }),
    );

    await waitFor(() => {
      expect(createUploadUrlMock).toHaveBeenCalledWith({
        filename: "pending.png",
        contentType: "image/png",
        scope: "organizations",
      });
    });

    unmount();

    expect(deleteBlobKeepaliveMock).toHaveBeenCalledWith(
      "organizations/user-1/logo-pending.png",
    );
  });

  it("saves organization profile fields from the Settings tab", async () => {
    const user = userEvent.setup();

    render(<OrganizationWorkspace />);

    await screen.findByRole("heading", { name: "Northwind" });
    await user.click(screen.getByRole("tab", { name: /Settings/i }));
    const description = screen.getByPlaceholderText(
      "Tell renters what your organization is about.",
    );
    await user.clear(description);
    await user.type(description, "Boutique rentals.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          name: "Northwind",
          description: "Boutique rentals.",
        }),
      );
    });
  });

  it("shows the create form when the authenticated user has no memberships", async () => {
    getMineMock.mockResolvedValue({ memberships: [] });

    render(<OrganizationWorkspace />);

    expect(
      await screen.findByText("Create your first organization"),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: /Team/i }));
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

