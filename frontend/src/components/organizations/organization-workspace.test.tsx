import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiNetworkError } from "@/lib/api/types";
import {
  resetRouterMocks,
  routerReplaceMock,
  routerPushMock,
  routerRefreshMock,
} from "@/test/mocks/next-navigation";
import { OrganizationWorkspaceProvider } from "@/components/organizations/workspace/workspace-provider";
import { WorkspaceChrome } from "@/components/organizations/workspace/workspace-chrome";
import { TeamPanel } from "@/components/organizations/workspace/panels/team-panel";
import { PostingsPanel } from "@/components/organizations/workspace/panels/postings-panel";
import { ActivityPanel } from "@/components/organizations/workspace/panels/activity-panel";
import { ContentPanel } from "@/components/organizations/workspace/panels/content-panel";
import { SettingsPanel } from "@/components/organizations/workspace/panels/settings-panel";

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
  listAnnouncementsMock,
  createAnnouncementMock,
  updateAnnouncementMock,
  deleteAnnouncementMock,
  listBlogPostsMock,
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
  useSelectedLayoutSegmentMock,
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
  listAnnouncementsMock: vi.fn(),
  createAnnouncementMock: vi.fn(),
  updateAnnouncementMock: vi.fn(),
  deleteAnnouncementMock: vi.fn(),
  listBlogPostsMock: vi.fn(),
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
  useSelectedLayoutSegmentMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
  useSelectedLayoutSegment: () => useSelectedLayoutSegmentMock(),
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
    listAnnouncements: listAnnouncementsMock,
    createAnnouncement: createAnnouncementMock,
    updateAnnouncement: updateAnnouncementMock,
    deleteAnnouncement: deleteAnnouncementMock,
    listBlogPosts: listBlogPostsMock,
    createBlogPost: vi.fn(),
    updateBlogPost: vi.fn(),
    deleteBlogPost: vi.fn(),
    revokeInvite: revokeInviteMock,
    updateMemberRole: updateMemberRoleMock,
    removeMember: removeMemberMock,
  },
}));

function renderInWorkspace(ui: ReactNode) {
  return render(
    <OrganizationWorkspaceProvider>{ui}</OrganizationWorkspaceProvider>,
  );
}

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

const emptyAuditResult = {
  auditLogs: [],
  pagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const emptyAnnouncementsResult = {
  announcements: [],
  pagination: {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

describe("Organization workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    useSelectedLayoutSegmentMock.mockReturnValue("overview");
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
    });
    updateMock.mockResolvedValue({
      id: "org-1",
      name: "Northwind",
      role: "primary_manager",
    });
    refreshMock.mockResolvedValue(null);
    listMinePostingsMock.mockResolvedValue({ postings: [] });
    createInviteMock.mockResolvedValue({ invitation: { id: "invite-1" } });
    listAuditMock.mockResolvedValue(emptyAuditResult);
    restoreAuditEntryMock.mockResolvedValue({
      restored: true,
      auditLog: { id: "audit-restore" },
    });
    listAnnouncementsMock.mockResolvedValue(emptyAnnouncementsResult);
    createAnnouncementMock.mockResolvedValue({ id: "announcement-1" });
    updateAnnouncementMock.mockResolvedValue({ id: "announcement-1" });
    deleteAnnouncementMock.mockResolvedValue({
      deleted: true,
      announcementId: "announcement-1",
    });
    listBlogPostsMock.mockResolvedValue({ posts: [] });
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

    renderInWorkspace(<div />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        "/login?next=/dashboard/organizations",
      );
    });
  });

  it("shows the overview quick actions and organization header", async () => {
    renderInWorkspace(<WorkspaceChrome>{null}</WorkspaceChrome>);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Northwind" },
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    // Settings is available to a primary manager.
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument();
  });

  it("hides manager-only sections from the sidebar for a manager", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: setSessionMock,
      session: buildSession("manager"),
    });
    getMineMock.mockResolvedValue({
      memberships: [{ ...workspacePayload.memberships[0], role: "manager" }],
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "manager" as const,
      },
    });
    getWorkspaceByIdMock.mockResolvedValue(buildDetailPayload("manager"));

    renderInWorkspace(<WorkspaceChrome>{null}</WorkspaceChrome>);

    await screen.findByRole(
      "heading",
      { name: "Northwind" },
      { timeout: 8000 },
    );
    // Managers can see Activity but not Settings.
    expect(screen.getByRole("link", { name: /Activity/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Settings/i }),
    ).not.toBeInTheDocument();
  });

  it("sends invites from the Team panel", async () => {
    const user = userEvent.setup();

    renderInWorkspace(<TeamPanel />);

    await user.type(
      await screen.findByPlaceholderText("teammate@example.com"),
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

  it("publishes a posting from the Postings panel", async () => {
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

    renderInWorkspace(<PostingsPanel />);

    await user.click(await screen.findByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(publishPostingMock).toHaveBeenCalledWith("posting-1");
    });
  });

  it("restores a restorable audit entry from the Activity panel", async () => {
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

    renderInWorkspace(<ActivityPanel />);

    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(restoreAuditEntryMock).toHaveBeenCalledWith("org-1", "audit-1");
    });
  });

  it("creates an announcement from the Content panel", async () => {
    const user = userEvent.setup();

    renderInWorkspace(<ContentPanel />);

    await user.type(await screen.findByLabelText("Title"), "Weekend update");
    await user.type(
      screen.getByLabelText("Message"),
      "We now accept weekend bookings.",
    );
    await user.click(screen.getByRole("button", { name: "Post announcement" }));

    await waitFor(() => {
      expect(createAnnouncementMock).toHaveBeenCalledWith("org-1", {
        title: "Weekend update",
        body: "We now accept weekend bookings.",
        status: "draft",
      });
    });
  });

  it("deletes an announcement from the Content panel", async () => {
    const user = userEvent.setup();
    listAnnouncementsMock.mockResolvedValue({
      announcements: [
        {
          id: "announcement-1",
          organizationId: "org-1",
          author: {
            id: "user-1",
            email: "owner@example.com",
            username: "owner-one",
          },
          title: "Weekend update",
          body: "We now accept weekend bookings.",
          status: "published",
          publishedAt: "2026-05-12T00:00:00.000Z",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    renderInWorkspace(<ContentPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteAnnouncementMock).toHaveBeenCalledWith(
        "org-1",
        "announcement-1",
      );
    });
  });

  it("shows announcements read-only for operators", async () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      setSession: setSessionMock,
      session: buildSession("operator"),
    });
    getWorkspaceByIdMock.mockResolvedValue(buildDetailPayload("operator"));
    getMineMock.mockResolvedValue({
      memberships: [
        {
          membershipId: "membership-2",
          id: "org-1",
          name: "Northwind",
          role: "operator" as const,
          joinedAt: "2026-05-03T00:00:00.000Z",
          isActive: true,
        },
      ],
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "operator" as const,
      },
    });
    listAnnouncementsMock.mockResolvedValue({
      announcements: [
        {
          id: "announcement-1",
          organizationId: "org-1",
          title: "Weekend update",
          body: "We now accept weekend bookings.",
          status: "published",
          publishedAt: "2026-05-12T00:00:00.000Z",
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    renderInWorkspace(<ContentPanel />);

    expect(await screen.findByText("Weekend update")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Post announcement" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
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

    renderInWorkspace(<SettingsPanel />);

    const input = await screen.findByLabelText("Upload organization logo");
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

    renderInWorkspace(<div />);

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

    const { unmount } = renderInWorkspace(<SettingsPanel />);

    await user.upload(
      await screen.findByLabelText("Upload organization logo"),
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

  it("saves organization profile fields from the Settings panel", async () => {
    const user = userEvent.setup();

    renderInWorkspace(<SettingsPanel />);

    // Wait for the workspace detail to load and populate the form before
    // editing, otherwise the async profile load clobbers the typed value.
    const description = await screen.findByDisplayValue(
      "Boutique furnished rentals for small creative teams.",
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

    renderInWorkspace(<WorkspaceChrome>{null}</WorkspaceChrome>);

    expect(
      await screen.findByText("Create your first organization", undefined, {
        timeout: 8000,
      }),
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

    renderInWorkspace(<TeamPanel />);

    await user.type(
      await screen.findByPlaceholderText("teammate@example.com"),
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
    });
  });
});
