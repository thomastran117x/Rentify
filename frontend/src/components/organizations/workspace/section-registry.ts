// Single source of truth for organization workspace sections. Replaces the
// scattered tab union, definitions array, per-role allow-lists, and badge
// switch that previously lived across organization-workspace.tsx.

import type { ComponentType } from "react";
import {
  Building2,
  History,
  LayoutDashboard,
  Megaphone,
  Settings,
  Users,
} from "lucide-react";
import type { OrganizationRole } from "@/lib/organizations/api";
import {
  canEditOrganizationSettings,
  canSeeOrganizationActivity,
} from "@/lib/auth/roles";

export type WorkspaceSectionId =
  | "overview"
  | "team"
  | "content"
  | "postings"
  | "activity"
  | "settings";

export interface WorkspaceSection {
  id: WorkspaceSectionId;
  /** URL segment under /dashboard/organizations. */
  segment: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Whether a member with the given role may open this section. */
  canAccess: (role?: OrganizationRole) => boolean;
}

const anyMember = (role?: OrganizationRole): boolean => Boolean(role);

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  {
    id: "overview",
    segment: "overview",
    label: "Overview",
    description: "Snapshot of the organization and key next actions.",
    icon: LayoutDashboard,
    canAccess: anyMember,
  },
  {
    id: "team",
    segment: "team",
    label: "Team",
    description: "Invites, roles, and membership management.",
    icon: Users,
    canAccess: anyMember,
  },
  {
    id: "content",
    segment: "content",
    label: "Content",
    description: "Announcements and public blog posts in one place.",
    icon: Megaphone,
    canAccess: anyMember,
  },
  {
    id: "postings",
    segment: "postings",
    label: "Postings",
    description: "Listing previews and lifecycle actions.",
    icon: Building2,
    canAccess: anyMember,
  },
  {
    id: "activity",
    segment: "activity",
    label: "Activity",
    description: "Audit history and restorable versions.",
    icon: History,
    canAccess: canSeeOrganizationActivity,
  },
  {
    id: "settings",
    segment: "settings",
    label: "Settings",
    description: "Organization profile and contact details.",
    icon: Settings,
    canAccess: canEditOrganizationSettings,
  },
];

export function getAccessibleSections(
  role?: OrganizationRole,
): WorkspaceSection[] {
  return WORKSPACE_SECTIONS.filter((section) => section.canAccess(role));
}

export function findSectionBySegment(
  segment: string | null,
): WorkspaceSection | undefined {
  if (!segment) {
    return undefined;
  }
  return WORKSPACE_SECTIONS.find((section) => section.segment === segment);
}
