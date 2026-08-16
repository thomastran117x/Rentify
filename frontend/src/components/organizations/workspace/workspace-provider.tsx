"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { blobApi } from "@/lib/blob/api";
import { authApi } from "@/lib/auth/api";
import {
  canEditOrganizationSettings,
  canInviteOrganizationMembers,
  canManageOrganizationContent,
  canManageOrganizationPostings,
  canSeeOrganizationActivity,
} from "@/lib/auth/roles";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type CreateOrganizationInviteInput,
  type OrganizationAnnouncementRecord,
  type OrganizationAnnouncementStatus,
  type OrganizationAuditRecord,
  type OrganizationBlogPostRecord,
  type OrganizationBlogStatus,
  type OrganizationDetailResult,
  type OrganizationRole,
  type OrganizationWorkspaceResult,
} from "@/lib/organizations/api";
import {
  emptyBlogForm,
  type BlogFormValue,
} from "@/components/organizations/blog-panel";
import { postingsApi, type PostingRecord } from "@/lib/postings/api";
import {
  emptyAnnouncementForm,
  emptyProfileForm,
  profileFormFromDetail,
  profileFormToInput,
  validateOrganizationSlug,
  type AnnouncementFormValue,
  type ProfileFormValue,
} from "@/components/organizations/workspace/forms";
import {
  readStagedOrganizationLogoBlobNames,
  writeStagedOrganizationLogoBlobNames,
} from "@/components/organizations/workspace/logo-storage";

export type PostingLifecycleAction =
  | "publish"
  | "pause"
  | "unpause"
  | "archive";

const POSTINGS_PREVIEW_LIMIT = 5;

type AuthContextShape = ReturnType<typeof useAuth>;

export interface OrganizationWorkspaceContextValue {
  // Auth + core workspace state
  status: AuthContextShape["status"];
  session: AuthContextShape["session"];
  workspace: OrganizationWorkspaceResult | null;
  detail: OrganizationDetailResult | null;
  selectedOrganizationId: string | null;
  loading: boolean;
  saving: boolean;
  errorTitle: string | null;
  error: string | null;
  message: string | null;
  showWorkspaceToast: (title: string, body: string) => void;

  // Derived counts / permissions
  membershipCount: number;
  memberCount: number;
  inviteCount: number;
  canInvite: boolean;
  canManagePostings: boolean;
  canSeeActivity: boolean;
  canManageAnnouncements: boolean;
  canManageBlog: boolean;
  canEditSettings: boolean;

  // Header / organization switching + creation
  showCreatePanel: boolean;
  toggleCreatePanel: () => void;
  newOrganizationName: string;
  setNewOrganizationName: (value: string) => void;
  createProfile: ProfileFormValue;
  handleCreateProfileChange: (next: ProfileFormValue) => void;
  handleCreate: () => Promise<void>;
  handleSelectOrganization: (organizationId: string) => Promise<void>;

  // Team
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  inviteRole: CreateOrganizationInviteInput["role"];
  setInviteRole: (role: CreateOrganizationInviteInput["role"]) => void;
  handleInvite: () => Promise<void>;
  handleRevokeInvite: (inviteId: string) => Promise<void>;
  handleUpdateMemberRole: (
    memberId: string,
    role: Exclude<OrganizationRole, "primary_manager">,
  ) => Promise<void>;
  handleRemoveMember: (memberId: string) => Promise<void>;

  // Postings
  postings: PostingRecord[];
  postingsTotal: number;
  postingsLoading: boolean;
  postingsError: string | null;
  handlePostingLifecycle: (
    postingId: string,
    action: PostingLifecycleAction,
  ) => Promise<void>;

  // Activity
  auditLogs: OrganizationAuditRecord[];
  auditLoading: boolean;
  auditError: string | null;
  restoringAuditId: string | null;
  handleRestoreAudit: (auditId: string) => Promise<void>;

  // Announcements
  announcements: OrganizationAnnouncementRecord[];
  announcementsLoading: boolean;
  announcementsError: string | null;
  announcementForm: AnnouncementFormValue;
  setAnnouncementForm: (value: AnnouncementFormValue) => void;
  editingAnnouncementId: string | null;
  announcementSavingId: string | null;
  handleSubmitAnnouncement: () => Promise<void>;
  handleCancelEditAnnouncement: () => void;
  handleEditAnnouncement: (
    announcement: OrganizationAnnouncementRecord,
  ) => void;
  handleToggleAnnouncementStatus: (
    announcement: OrganizationAnnouncementRecord,
  ) => Promise<void>;
  handleDeleteAnnouncement: (announcementId: string) => Promise<void>;

  // Blog
  blogPosts: OrganizationBlogPostRecord[];
  blogLoading: boolean;
  blogError: string | null;
  blogForm: BlogFormValue;
  setBlogForm: (value: BlogFormValue) => void;
  editingBlogPostId: string | null;
  blogSavingId: string | null;
  handleSubmitBlogPost: () => Promise<void>;
  handleCancelEditBlogPost: () => void;
  handleEditBlogPost: (post: OrganizationBlogPostRecord) => void;
  handleToggleBlogStatus: (post: OrganizationBlogPostRecord) => Promise<void>;
  handleDeleteBlogPost: (postId: string) => Promise<void>;

  // Settings
  organizationName: string;
  setOrganizationName: (value: string) => void;
  organizationSlug: string;
  setOrganizationSlug: (value: string) => void;
  organizationSlugError: string | null;
  savingSlug: boolean;
  handleSaveSlug: () => Promise<void>;
  profileForm: ProfileFormValue;
  handleProfileFormChange: (next: ProfileFormValue) => void;
  handleSaveProfile: () => Promise<void>;
}

const OrganizationWorkspaceContext =
  createContext<OrganizationWorkspaceContextValue | null>(null);

export function useOrganizationWorkspace(): OrganizationWorkspaceContextValue {
  const value = useContext(OrganizationWorkspaceContext);
  if (!value) {
    throw new Error(
      "useOrganizationWorkspace must be used within an OrganizationWorkspaceProvider.",
    );
  }
  return value;
}

export function OrganizationWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const { status, session, setSession } = useAuth();
  const { showError } = useErrorToast();
  const [workspace, setWorkspace] =
    useState<OrganizationWorkspaceResult | null>(null);
  const [detail, setDetail] = useState<OrganizationDetailResult | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [savingSlug, setSavingSlug] = useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [createProfile, setCreateProfile] =
    useState<ProfileFormValue>(emptyProfileForm());
  const [profileForm, setProfileForm] =
    useState<ProfileFormValue>(emptyProfileForm());
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<CreateOrganizationInviteInput["role"]>("operator");
  const [postings, setPostings] = useState<PostingRecord[]>([]);
  const [postingsTotal, setPostingsTotal] = useState(0);
  const [postingsLoading, setPostingsLoading] = useState(false);
  const [postingsError, setPostingsError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<OrganizationAuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [restoringAuditId, setRestoringAuditId] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<
    OrganizationAnnouncementRecord[]
  >([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(
    null,
  );
  const [announcementForm, setAnnouncementForm] =
    useState<AnnouncementFormValue>(emptyAnnouncementForm());
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<
    string | null
  >(null);
  const [announcementSavingId, setAnnouncementSavingId] = useState<
    string | null
  >(null);
  const [blogPosts, setBlogPosts] = useState<OrganizationBlogPostRecord[]>([]);
  const [blogLoading, setBlogLoading] = useState(false);
  const [blogError, setBlogError] = useState<string | null>(null);
  const [blogForm, setBlogForm] = useState<BlogFormValue>(emptyBlogForm());
  const [editingBlogPostId, setEditingBlogPostId] = useState<string | null>(
    null,
  );
  const [blogSavingId, setBlogSavingId] = useState<string | null>(null);
  const stagedLogoBlobNamesRef = useRef<Set<string>>(new Set());

  function showWorkspaceToast(title: string, body: string) {
    showError({
      title,
      message: body,
      tone: "error",
    });
  }

  function getWorkspaceActionError(
    nextError: unknown,
    action: string,
    fallback: string,
  ) {
    return getApiErrorMessage(nextError, {
      action,
      fallback,
      preserveClientMessage: true,
    });
  }

  function syncStagedLogoBlobStorage() {
    if (!session?.user.id) {
      return;
    }

    writeStagedOrganizationLogoBlobNames(
      session.user.id,
      stagedLogoBlobNamesRef.current,
    );
  }

  function rememberStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();

    if (!normalizedBlobName) {
      return;
    }

    stagedLogoBlobNamesRef.current.add(normalizedBlobName);
    syncStagedLogoBlobStorage();
  }

  function forgetStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();

    if (!normalizedBlobName) {
      return;
    }

    stagedLogoBlobNamesRef.current.delete(normalizedBlobName);
    syncStagedLogoBlobStorage();
  }

  function isStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();
    return (
      normalizedBlobName.length > 0 &&
      stagedLogoBlobNamesRef.current.has(normalizedBlobName)
    );
  }

  async function deleteStagedLogoBlob(blobName: string) {
    const normalizedBlobName = blobName.trim();

    if (!normalizedBlobName) {
      return;
    }

    try {
      await blobApi.deleteBlob(normalizedBlobName);
      forgetStagedLogoBlob(normalizedBlobName);
    } catch {
      syncStagedLogoBlobStorage();
    }
  }

  function reconcileStagedLogoBlobChange(
    previousValue: ProfileFormValue,
    nextValue: ProfileFormValue,
  ) {
    const previousBlobName = previousValue.logoBlobName.trim();
    const nextBlobName = nextValue.logoBlobName.trim();

    if (nextBlobName && nextBlobName !== previousBlobName) {
      rememberStagedLogoBlob(nextBlobName);
    }

    if (
      previousBlobName &&
      previousBlobName !== nextBlobName &&
      isStagedLogoBlob(previousBlobName)
    ) {
      void deleteStagedLogoBlob(previousBlobName);
    }
  }

  function handleCreateProfileChange(nextValue: ProfileFormValue) {
    reconcileStagedLogoBlobChange(createProfile, nextValue);
    setCreateProfile(nextValue);
  }

  function handleProfileFormChange(nextValue: ProfileFormValue) {
    reconcileStagedLogoBlobChange(profileForm, nextValue);
    setProfileForm(nextValue);
  }

  useEffect(() => {
    if (status !== "authenticated" || !session?.user.id) {
      stagedLogoBlobNamesRef.current.clear();
      return;
    }

    const stagedBlobNames = readStagedOrganizationLogoBlobNames(
      session.user.id,
    );
    stagedLogoBlobNamesRef.current = new Set(stagedBlobNames);

    if (stagedBlobNames.length === 0) {
      return;
    }

    void Promise.allSettled(
      stagedBlobNames.map(async (blobName) => {
        try {
          await blobApi.deleteBlob(blobName);
          forgetStagedLogoBlob(blobName);
        } catch {
          syncStagedLogoBlobStorage();
        }
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, status]);

  useEffect(() => {
    if (status !== "authenticated" || !session) {
      return;
    }

    function flushStagedLogoBlobs() {
      for (const blobName of stagedLogoBlobNamesRef.current) {
        blobApi.deleteBlobKeepalive(blobName);
      }
    }

    window.addEventListener("pagehide", flushStagedLogoBlobs);

    return () => {
      window.removeEventListener("pagehide", flushStagedLogoBlobs);
      flushStagedLogoBlobs();
    };
  }, [session, status]);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=/dashboard/organizations");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    async function loadWorkspace() {
      setLoading(true);
      setErrorTitle(null);
      setError(null);

      try {
        const nextWorkspace = await organizationsApi.getMine();

        if (!active) {
          return;
        }

        const nextOrganizationId =
          nextWorkspace.activeOrganization?.id ??
          nextWorkspace.memberships[0]?.id ??
          null;

        // A detail failure must not discard the loaded workspace, otherwise an
        // existing member is wrongly shown the "create your first organization"
        // empty state. Keep the workspace and surface the error instead.
        let nextDetail: OrganizationDetailResult | null = null;
        if (nextOrganizationId) {
          try {
            nextDetail =
              await organizationsApi.getWorkspaceById(nextOrganizationId);
          } catch (detailError) {
            if (active) {
              setErrorTitle("Couldn't load organization workspace");
              setError(
                getApiErrorMessage(detailError, {
                  action: "load this organization's workspace",
                  fallback:
                    "We couldn't load this organization's details right now. Please try again.",
                }),
              );
            }
          }
        }

        if (!active) {
          return;
        }

        startTransition(() => {
          setWorkspace(nextWorkspace);
          setSelectedOrganizationId(nextOrganizationId);
          setDetail(nextDetail);
          setOrganizationName(nextDetail?.organization.name ?? "");
          setOrganizationSlug(nextDetail?.organization.slug ?? "");
          setProfileForm(
            nextDetail
              ? profileFormFromDetail(nextDetail.organization)
              : emptyProfileForm(),
          );
        });
      } catch (nextError) {
        if (active) {
          setErrorTitle("Couldn't load organization workspace");
          setError(
            getApiErrorMessage(nextError, {
              action: "load your organization workspace",
              fallback:
                "We couldn't load your organization workspace right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !selectedOrganizationId) {
      return;
    }

    let active = true;

    async function loadPostings() {
      setPostingsLoading(true);
      setPostingsError(null);

      try {
        const result = await postingsApi.listMine({
          pageSize: POSTINGS_PREVIEW_LIMIT,
        });

        if (!active) {
          return;
        }

        startTransition(() => {
          setPostings(result.postings);
          setPostingsTotal(result.pagination?.total ?? result.postings.length);
        });
      } catch (nextError) {
        if (active) {
          setPostings([]);
          setPostingsTotal(0);
          setPostingsError(
            getApiErrorMessage(nextError, {
              action: "load this organization's postings",
              fallback:
                "We couldn't load postings for this organization right now.",
            }),
          );
        }
      } finally {
        if (active) {
          setPostingsLoading(false);
        }
      }
    }

    void loadPostings();

    return () => {
      active = false;
    };
  }, [selectedOrganizationId, status]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !selectedOrganizationId ||
      detail?.viewerRole === "operator"
    ) {
      setAuditLogs([]);
      return;
    }

    let active = true;

    async function loadAudit() {
      setAuditLoading(true);
      setAuditError(null);

      try {
        const result = await organizationsApi.listAudit(
          selectedOrganizationId!,
        );

        if (!active) {
          return;
        }

        startTransition(() => {
          setAuditLogs(result.auditLogs);
        });
      } catch (nextError) {
        if (active) {
          setAuditLogs([]);
          setAuditError(
            getApiErrorMessage(nextError, {
              action: "load organization audit history",
              fallback:
                "We couldn't load this organization's audit history right now.",
            }),
          );
        }
      } finally {
        if (active) {
          setAuditLoading(false);
        }
      }
    }

    void loadAudit();

    return () => {
      active = false;
    };
  }, [detail?.viewerRole, selectedOrganizationId, status]);

  useEffect(() => {
    if (status !== "authenticated" || !selectedOrganizationId) {
      setAnnouncements([]);
      return;
    }

    let active = true;

    async function loadAnnouncements() {
      setAnnouncementsLoading(true);
      setAnnouncementsError(null);

      try {
        const result = await organizationsApi.listAnnouncements(
          selectedOrganizationId!,
        );

        if (!active) {
          return;
        }

        startTransition(() => {
          setAnnouncements(result.announcements);
        });
      } catch (nextError) {
        if (active) {
          setAnnouncements([]);
          setAnnouncementsError(
            getApiErrorMessage(nextError, {
              action: "load organization announcements",
              fallback:
                "We couldn't load this organization's announcements right now.",
            }),
          );
        }
      } finally {
        if (active) {
          setAnnouncementsLoading(false);
        }
      }
    }

    void loadAnnouncements();

    return () => {
      active = false;
    };
  }, [selectedOrganizationId, status]);

  useEffect(() => {
    if (status !== "authenticated" || !selectedOrganizationId) {
      setBlogPosts([]);
      return;
    }

    let active = true;

    async function loadBlogPosts() {
      setBlogLoading(true);
      setBlogError(null);

      try {
        const result = await organizationsApi.listBlogPosts(
          selectedOrganizationId!,
        );

        if (!active) {
          return;
        }

        startTransition(() => {
          setBlogPosts(result.posts);
        });
      } catch (nextError) {
        if (active) {
          setBlogPosts([]);
          setBlogError(
            getApiErrorMessage(nextError, {
              action: "load organization blog posts",
              fallback:
                "We couldn't load this organization's blog posts right now.",
            }),
          );
        }
      } finally {
        if (active) {
          setBlogLoading(false);
        }
      }
    }

    void loadBlogPosts();

    return () => {
      active = false;
    };
  }, [selectedOrganizationId, status]);

  const canSeeActivity = canSeeOrganizationActivity(detail?.viewerRole);

  async function refresh(selectedId = selectedOrganizationId) {
    const nextWorkspace = await organizationsApi.getMine();
    const resolvedOrganizationId =
      selectedId ??
      nextWorkspace.activeOrganization?.id ??
      nextWorkspace.memberships[0]?.id ??
      null;
    const nextDetail = resolvedOrganizationId
      ? await organizationsApi.getWorkspaceById(resolvedOrganizationId)
      : null;

    startTransition(() => {
      setWorkspace(nextWorkspace);
      setSelectedOrganizationId(resolvedOrganizationId);
      setDetail(nextDetail);
      setOrganizationName(nextDetail?.organization.name ?? "");
      setOrganizationSlug(nextDetail?.organization.slug ?? "");
      setProfileForm(
        nextDetail
          ? profileFormFromDetail(nextDetail.organization)
          : emptyProfileForm(),
      );
    });
  }

  async function handleCreate() {
    const trimmedName = newOrganizationName.trim();

    if (trimmedName.length === 0) {
      return;
    }

    const submittedLogoBlobName = createProfile.logoBlobName.trim();

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      const result = await organizationsApi.create({
        name: trimmedName,
        ...profileFormToInput(createProfile),
      });

      forgetStagedLogoBlob(submittedLogoBlobName);

      const refreshedSession = await authApi.refresh();

      if (refreshedSession) {
        setSession(refreshedSession);
      }

      await refresh(result.organization.id);
      setNewOrganizationName("");
      setCreateProfile(emptyProfileForm());
      setShowCreatePanel(false);
      setMessage(`${result.organization.name} created.`);
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "create that organization",
        "We couldn't create that organization right now. Please try again.",
      );
      setErrorTitle("Couldn't create organization");
      setError(nextMessage);
      showWorkspaceToast("Couldn't create organization", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleSelectOrganization(organizationId: string) {
    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.setActive({ organizationId });

      const refreshedSession = await authApi.refresh();

      if (refreshedSession) {
        setSession(refreshedSession);
      }

      await refresh(organizationId);
      setMessage("Active organization updated.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "switch your active organization",
        "We couldn't switch your active organization right now. Please try again.",
      );
      setErrorTitle("Couldn't switch organizations");
      setError(nextMessage);
      showWorkspaceToast("Couldn't switch organizations", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  // Deliberately separate from handleSaveProfile: changing the public URL
  // retires the old one, so it must not ride along on a routine profile save.
  async function handleSaveSlug() {
    if (!detail) {
      return;
    }

    const nextSlug = organizationSlug.trim().toLowerCase();

    if (nextSlug === detail.organization.slug) {
      return;
    }

    if (validateOrganizationSlug(nextSlug)) {
      return;
    }

    setSavingSlug(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.updateSlug(detail.organization.id, nextSlug);
      await refresh(detail.organization.id);
      setMessage("Organization URL updated. Existing links now redirect here.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "change this organization's URL",
        "We couldn't change this organization's URL right now. Please try again.",
      );
      setErrorTitle("Couldn't update organization URL");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update organization URL", nextMessage);
      // Put the field back to the persisted value so the UI never implies a
      // change that did not happen.
      setOrganizationSlug(detail.organization.slug);
    } finally {
      setSavingSlug(false);
    }
  }

  async function handleSaveProfile() {
    if (!detail) {
      return;
    }

    const submittedLogoBlobName = profileForm.logoBlobName.trim();

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.update(detail.organization.id, {
        name: organizationName,
        ...profileFormToInput(profileForm),
      });
      forgetStagedLogoBlob(submittedLogoBlobName);
      await refresh(detail.organization.id);
      setMessage("Organization profile updated.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "update this organization",
        "We couldn't update this organization right now. Please try again.",
      );
      setErrorTitle("Couldn't update organization");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update organization", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite() {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.createInvite(detail.organization.id, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      await refresh(detail.organization.id);
      setInviteEmail("");
      setInviteRole(detail.viewerRole === "manager" ? "operator" : inviteRole);
      setMessage("Invitation sent.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "send that invitation",
        "We couldn't send that invitation right now. Please try again.",
      );
      setErrorTitle("Couldn't send invitation");
      setError(nextMessage);
      showWorkspaceToast("Couldn't send invitation", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.revokeInvite(detail.organization.id, inviteId);
      await refresh(detail.organization.id);
      setMessage("Invitation revoked.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "revoke that invitation",
        "We couldn't revoke that invitation right now. Please try again.",
      );
      setErrorTitle("Couldn't revoke invitation");
      setError(nextMessage);
      showWorkspaceToast("Couldn't revoke invitation", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateMemberRole(
    memberId: string,
    role: Exclude<OrganizationRole, "primary_manager">,
  ) {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.updateMemberRole(
        detail.organization.id,
        memberId,
        role,
      );
      await refresh(detail.organization.id);
      setMessage("Member role updated.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "update that member's role",
        "We couldn't update that member's role right now. Please try again.",
      );
      setErrorTitle("Couldn't update member role");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update member role", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!detail) {
      return;
    }

    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.removeMember(detail.organization.id, memberId);
      await refresh(detail.organization.id);
      setMessage("Member removed.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "remove that member",
        "We couldn't remove that member right now. Please try again.",
      );
      setErrorTitle("Couldn't remove member");
      setError(nextMessage);
      showWorkspaceToast("Couldn't remove member", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handlePostingLifecycle(
    postingId: string,
    action: PostingLifecycleAction,
  ) {
    setSaving(true);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      if (action === "publish") {
        await postingsApi.publish(postingId);
      } else if (action === "pause") {
        await postingsApi.pausePosting(postingId);
      } else if (action === "unpause") {
        await postingsApi.unpausePosting(postingId);
      } else {
        await postingsApi.archive(postingId);
      }

      const result = await postingsApi.listMine({
        pageSize: POSTINGS_PREVIEW_LIMIT,
      });
      startTransition(() => {
        setPostings(result.postings);
        setPostingsTotal(result.pagination?.total ?? result.postings.length);
      });

      const pastTense: Record<PostingLifecycleAction, string> = {
        publish: "published",
        pause: "paused",
        unpause: "unpaused",
        archive: "archived",
      };
      setMessage(`Posting ${pastTense[action]}.`);
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        `${action} that posting`,
        "We couldn't update that posting right now. Please try again.",
      );
      setErrorTitle("Couldn't update posting");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update posting", nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreAudit(auditId: string) {
    if (!detail) {
      return;
    }

    setRestoringAuditId(auditId);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.restoreAuditEntry(detail.organization.id, auditId);
      await refresh(detail.organization.id);
      const [postingsResult, auditResult] = await Promise.all([
        postingsApi.listMine({ pageSize: POSTINGS_PREVIEW_LIMIT }),
        organizationsApi.listAudit(detail.organization.id),
      ]);
      startTransition(() => {
        setPostings(postingsResult.postings);
        setPostingsTotal(
          postingsResult.pagination?.total ?? postingsResult.postings.length,
        );
        setAuditLogs(auditResult.auditLogs);
      });
      setMessage("Version restored.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "restore that version",
        "We couldn't restore that version right now. Please try again.",
      );
      setErrorTitle("Couldn't restore version");
      setError(nextMessage);
      showWorkspaceToast("Couldn't restore version", nextMessage);
    } finally {
      setRestoringAuditId(null);
    }
  }

  async function reloadAnnouncements(organizationId: string) {
    const result = await organizationsApi.listAnnouncements(organizationId);
    startTransition(() => {
      setAnnouncements(result.announcements);
    });
  }

  function handleEditAnnouncement(
    announcement: OrganizationAnnouncementRecord,
  ) {
    setEditingAnnouncementId(announcement.id);
    setAnnouncementForm({
      title: announcement.title,
      body: announcement.body,
      status: announcement.status,
    });
  }

  function handleCancelEditAnnouncement() {
    setEditingAnnouncementId(null);
    setAnnouncementForm(emptyAnnouncementForm());
  }

  async function handleSubmitAnnouncement() {
    if (!detail) {
      return;
    }

    const title = announcementForm.title.trim();
    const body = announcementForm.body.trim();

    if (!title || !body) {
      showWorkspaceToast(
        "Couldn't save announcement",
        "Add a title and a message before saving.",
      );
      return;
    }

    const organizationId = detail.organization.id;
    setAnnouncementSavingId(editingAnnouncementId ?? "new");
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      if (editingAnnouncementId) {
        await organizationsApi.updateAnnouncement(
          organizationId,
          editingAnnouncementId,
          { title, body, status: announcementForm.status },
        );
        setMessage("Announcement updated.");
      } else {
        await organizationsApi.createAnnouncement(organizationId, {
          title,
          body,
          status: announcementForm.status,
        });
        setMessage("Announcement posted.");
      }

      await Promise.all([
        reloadAnnouncements(organizationId),
        canSeeActivity
          ? organizationsApi
              .listAudit(organizationId)
              .then((auditResult) => setAuditLogs(auditResult.auditLogs))
          : Promise.resolve(),
      ]);
      handleCancelEditAnnouncement();
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "save that announcement",
        "We couldn't save that announcement right now. Please try again.",
      );
      setErrorTitle("Couldn't save announcement");
      setError(nextMessage);
      showWorkspaceToast("Couldn't save announcement", nextMessage);
    } finally {
      setAnnouncementSavingId(null);
    }
  }

  async function handleToggleAnnouncementStatus(
    announcement: OrganizationAnnouncementRecord,
  ) {
    if (!detail) {
      return;
    }

    const organizationId = detail.organization.id;
    const nextStatus: OrganizationAnnouncementStatus =
      announcement.status === "published" ? "draft" : "published";
    setAnnouncementSavingId(announcement.id);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.updateAnnouncement(
        organizationId,
        announcement.id,
        { status: nextStatus },
      );
      await Promise.all([
        reloadAnnouncements(organizationId),
        canSeeActivity
          ? organizationsApi
              .listAudit(organizationId)
              .then((auditResult) => setAuditLogs(auditResult.auditLogs))
          : Promise.resolve(),
      ]);
      setMessage(
        nextStatus === "published"
          ? "Announcement published."
          : "Announcement moved to draft.",
      );
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "update that announcement",
        "We couldn't update that announcement right now. Please try again.",
      );
      setErrorTitle("Couldn't update announcement");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update announcement", nextMessage);
    } finally {
      setAnnouncementSavingId(null);
    }
  }

  async function handleDeleteAnnouncement(announcementId: string) {
    if (!detail) {
      return;
    }

    const organizationId = detail.organization.id;
    setAnnouncementSavingId(announcementId);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.deleteAnnouncement(organizationId, announcementId);
      if (editingAnnouncementId === announcementId) {
        handleCancelEditAnnouncement();
      }
      await Promise.all([
        reloadAnnouncements(organizationId),
        canSeeActivity
          ? organizationsApi
              .listAudit(organizationId)
              .then((auditResult) => setAuditLogs(auditResult.auditLogs))
          : Promise.resolve(),
      ]);
      setMessage("Announcement deleted.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "delete that announcement",
        "We couldn't delete that announcement right now. Please try again.",
      );
      setErrorTitle("Couldn't delete announcement");
      setError(nextMessage);
      showWorkspaceToast("Couldn't delete announcement", nextMessage);
    } finally {
      setAnnouncementSavingId(null);
    }
  }

  async function reloadBlogPosts(organizationId: string) {
    const result = await organizationsApi.listBlogPosts(organizationId);
    startTransition(() => {
      setBlogPosts(result.posts);
    });
  }

  function handleEditBlogPost(post: OrganizationBlogPostRecord) {
    setEditingBlogPostId(post.id);
    setBlogForm({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt ?? "",
      body: post.body,
      tags: post.tags,
      coverImageUrl: post.coverImageUrl ?? "",
      coverImageBlobName: post.coverImageBlobName ?? "",
      status: post.status,
      commentsEnabled: post.commentsEnabled,
    });
  }

  function handleCancelEditBlogPost() {
    setEditingBlogPostId(null);
    setBlogForm(emptyBlogForm());
  }

  function buildBlogPayload() {
    const title = blogForm.title.trim();
    const excerpt = blogForm.excerpt.trim();
    return {
      title,
      body: blogForm.body,
      excerpt: excerpt ? excerpt : null,
      tags: blogForm.tags,
      coverImageUrl: blogForm.coverImageBlobName
        ? blogForm.coverImageUrl
        : null,
      coverImageBlobName: blogForm.coverImageBlobName || null,
      status: blogForm.status,
      commentsEnabled: blogForm.commentsEnabled,
    };
  }

  async function handleSubmitBlogPost() {
    if (!detail) {
      return;
    }

    const title = blogForm.title.trim();
    const bodyText = blogForm.body.replace(/<[^>]*>/g, "").trim();

    if (!title || !bodyText) {
      showWorkspaceToast(
        "Couldn't save blog post",
        "Add a title and some body content before saving.",
      );
      return;
    }

    const organizationId = detail.organization.id;
    setBlogSavingId(editingBlogPostId ?? "new");
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      const payload = buildBlogPayload();
      if (editingBlogPostId) {
        await organizationsApi.updateBlogPost(
          organizationId,
          editingBlogPostId,
          payload,
        );
        setMessage("Blog post updated.");
      } else {
        await organizationsApi.createBlogPost(organizationId, payload);
        setMessage("Blog post published.");
      }

      await Promise.all([
        reloadBlogPosts(organizationId),
        canSeeActivity
          ? organizationsApi
              .listAudit(organizationId)
              .then((auditResult) => setAuditLogs(auditResult.auditLogs))
          : Promise.resolve(),
      ]);
      handleCancelEditBlogPost();
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "save that blog post",
        "We couldn't save that blog post right now. Please try again.",
      );
      setErrorTitle("Couldn't save blog post");
      setError(nextMessage);
      showWorkspaceToast("Couldn't save blog post", nextMessage);
    } finally {
      setBlogSavingId(null);
    }
  }

  async function handleToggleBlogStatus(post: OrganizationBlogPostRecord) {
    if (!detail) {
      return;
    }

    const organizationId = detail.organization.id;
    const nextStatus: OrganizationBlogStatus =
      post.status === "published" ? "draft" : "published";
    setBlogSavingId(post.id);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.updateBlogPost(organizationId, post.id, {
        status: nextStatus,
      });
      await Promise.all([
        reloadBlogPosts(organizationId),
        canSeeActivity
          ? organizationsApi
              .listAudit(organizationId)
              .then((auditResult) => setAuditLogs(auditResult.auditLogs))
          : Promise.resolve(),
      ]);
      setMessage(
        nextStatus === "published"
          ? "Blog post published."
          : "Blog post moved to draft.",
      );
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "update that blog post",
        "We couldn't update that blog post right now. Please try again.",
      );
      setErrorTitle("Couldn't update blog post");
      setError(nextMessage);
      showWorkspaceToast("Couldn't update blog post", nextMessage);
    } finally {
      setBlogSavingId(null);
    }
  }

  async function handleDeleteBlogPost(postId: string) {
    if (!detail) {
      return;
    }

    const organizationId = detail.organization.id;
    setBlogSavingId(postId);
    setErrorTitle(null);
    setError(null);
    setMessage(null);

    try {
      await organizationsApi.deleteBlogPost(organizationId, postId);
      if (editingBlogPostId === postId) {
        handleCancelEditBlogPost();
      }
      await Promise.all([
        reloadBlogPosts(organizationId),
        canSeeActivity
          ? organizationsApi
              .listAudit(organizationId)
              .then((auditResult) => setAuditLogs(auditResult.auditLogs))
          : Promise.resolve(),
      ]);
      setMessage("Blog post deleted.");
    } catch (nextError) {
      const nextMessage = getWorkspaceActionError(
        nextError,
        "delete that blog post",
        "We couldn't delete that blog post right now. Please try again.",
      );
      setErrorTitle("Couldn't delete blog post");
      setError(nextMessage);
      showWorkspaceToast("Couldn't delete blog post", nextMessage);
    } finally {
      setBlogSavingId(null);
    }
  }

  const memberCount = detail?.members.length ?? 0;
  const inviteCount = detail?.invitations.length ?? 0;
  const membershipCount = workspace?.memberships.length ?? 0;
  const canManagePostings = detail
    ? canManageOrganizationPostings({
        id: detail.organization.id,
        name: detail.organization.name,
        role: detail.viewerRole,
      })
    : false;
  const canManageAnnouncements = canManageOrganizationContent(
    detail?.viewerRole,
  );
  const canManageBlog = canManageOrganizationContent(detail?.viewerRole);
  const canEditSettings = canEditOrganizationSettings(detail?.viewerRole);
  const canInvite = canInviteOrganizationMembers(detail?.viewerRole);

  const value: OrganizationWorkspaceContextValue = {
    status,
    session,
    workspace,
    detail,
    selectedOrganizationId,
    loading,
    saving,
    errorTitle,
    error,
    message,
    showWorkspaceToast,
    membershipCount,
    memberCount,
    inviteCount,
    canInvite,
    canManagePostings,
    canSeeActivity,
    canManageAnnouncements,
    canManageBlog,
    canEditSettings,
    showCreatePanel,
    toggleCreatePanel: () => setShowCreatePanel((current) => !current),
    newOrganizationName,
    setNewOrganizationName,
    createProfile,
    handleCreateProfileChange,
    handleCreate,
    handleSelectOrganization,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    handleInvite,
    handleRevokeInvite,
    handleUpdateMemberRole,
    handleRemoveMember,
    postings,
    postingsTotal,
    postingsLoading,
    postingsError,
    handlePostingLifecycle,
    auditLogs,
    auditLoading,
    auditError,
    restoringAuditId,
    handleRestoreAudit,
    announcements,
    announcementsLoading,
    announcementsError,
    announcementForm,
    setAnnouncementForm,
    editingAnnouncementId,
    announcementSavingId,
    handleSubmitAnnouncement,
    handleCancelEditAnnouncement,
    handleEditAnnouncement,
    handleToggleAnnouncementStatus,
    handleDeleteAnnouncement,
    blogPosts,
    blogLoading,
    blogError,
    blogForm,
    setBlogForm,
    editingBlogPostId,
    blogSavingId,
    handleSubmitBlogPost,
    handleCancelEditBlogPost,
    handleEditBlogPost,
    handleToggleBlogStatus,
    handleDeleteBlogPost,
    organizationName,
    setOrganizationName,
    organizationSlug,
    setOrganizationSlug,
    organizationSlugError: organizationSlug.trim()
      ? validateOrganizationSlug(organizationSlug)
      : null,
    savingSlug,
    handleSaveSlug,
    profileForm,
    handleProfileFormChange,
    handleSaveProfile,
  };

  return (
    <OrganizationWorkspaceContext.Provider value={value}>
      {children}
    </OrganizationWorkspaceContext.Provider>
  );
}
