"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { OrganizationDetailResult } from "@/lib/organizations/api";
import { fieldLabelClass } from "@/components/organizations/shared/styles";
import { RoleBadge } from "@/components/organizations/shared/badges";
import { formatDate } from "@/components/organizations/shared/format";
import {
  SectionCard,
  SurfaceNote,
  WorkspaceQuickActionCard,
} from "@/components/organizations/shared/primitives";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

function formatAddress(
  organization: OrganizationDetailResult["organization"],
): string | null {
  const parts = [
    organization.addressLine1,
    organization.addressLine2,
    organization.city,
    organization.region,
    organization.postalCode,
    organization.country,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));
  return parts.length > 0 ? parts.join(", ") : null;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <dt className={fieldLabelClass}>{label}</dt>
      <dd className="text-sm text-slate-700 dark:text-slate-200">{children}</dd>
    </div>
  );
}

function OrganizationAboutCard({
  organization,
}: {
  organization: OrganizationDetailResult["organization"];
}) {
  const address = formatAddress(organization);
  const customFields = Object.entries(organization.customFields ?? {});
  const hasContent =
    Boolean(organization.description) ||
    Boolean(organization.websiteUrl) ||
    Boolean(organization.contactEmail) ||
    Boolean(organization.contactPhone) ||
    Boolean(address) ||
    customFields.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <SectionCard eyebrow="About" title="Organization details">
      <div className="grid gap-6">
        {organization.description ? (
          <p className="whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-200">
            {organization.description}
          </p>
        ) : null}
        <dl className="grid gap-5 sm:grid-cols-2">
          {organization.websiteUrl ? (
            <DetailRow label="Website">
              <a
                href={organization.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                {organization.websiteUrl}
              </a>
            </DetailRow>
          ) : null}
          {organization.contactEmail ? (
            <DetailRow label="Contact email">
              <a
                href={`mailto:${organization.contactEmail}`}
                className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                {organization.contactEmail}
              </a>
            </DetailRow>
          ) : null}
          {organization.contactPhone ? (
            <DetailRow label="Contact phone">
              {organization.contactPhone}
            </DetailRow>
          ) : null}
          {address ? <DetailRow label="Address">{address}</DetailRow> : null}
          {customFields.map(([key, value]) => (
            <DetailRow key={key} label={key}>
              {value}
            </DetailRow>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}

function OrganizationBasicsCard({
  detail,
  membershipCount,
}: {
  detail: OrganizationDetailResult;
  membershipCount: number;
}) {
  return (
    <SectionCard
      eyebrow="Context"
      title="Current organization context"
      description="A quick read on who can act here and how this workspace fits into your broader organization access."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SurfaceNote>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Your role
          </p>
          <div className="mt-3 inline-flex">
            <RoleBadge role={detail.viewerRole} />
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {detail.viewerRole === "operator"
              ? "You can review membership, invitations, and postings, but managers handle changes."
              : detail.viewerRole === "manager"
                ? "You can invite operators, manage postings, and review activity."
                : "You control the full organization profile, team access, and activity history."}
          </p>
        </SurfaceNote>
        <SurfaceNote>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Memberships
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {membershipCount}
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Switch between organizations from the header without losing your
            place in this workspace.
          </p>
        </SurfaceNote>
        <SurfaceNote>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Created
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {formatDate(detail.organization.createdAt)}
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Keep brand details current so renters recognize this organization
            across listings and booking flows.
          </p>
        </SurfaceNote>
      </div>
    </SectionCard>
  );
}

export function OverviewPanel() {
  const router = useRouter();
  const {
    detail,
    membershipCount,
    memberCount,
    inviteCount,
    postingsTotal,
    auditLogs,
    canInvite,
    canSeeActivity,
    canEditSettings,
  } = useOrganizationWorkspace();

  if (!detail) {
    return null;
  }

  const openSection = (segment: string) =>
    router.push(`/dashboard/organizations/${segment}`);

  const quickActions: Array<{
    segment: string;
    eyebrow: string;
    title: string;
    description: string;
    meta: string;
  }> = [
    {
      segment: "team",
      eyebrow: "Team",
      title: canInvite
        ? "Manage teammates and invites"
        : "Review teammates and invites",
      description:
        detail.viewerRole === "operator"
          ? "See who belongs to this organization and which invitations are still pending."
          : "Send new invites, review pending access, and keep member roles tidy.",
      meta: `${memberCount} members / ${inviteCount} pending`,
    },
    {
      segment: "postings",
      eyebrow: "Postings",
      title: "Check listing readiness",
      description:
        detail.viewerRole === "operator"
          ? "Review the current listings that belong to this organization."
          : "Create new listings, update status, and jump into editing from one panel.",
      meta: `${postingsTotal} listings`,
    },
  ];

  if (canSeeActivity) {
    quickActions.push({
      segment: "activity",
      eyebrow: "Activity",
      title: "Review recent changes",
      description:
        "Track manager actions, posting changes, and restorable versions without scrolling past every other surface.",
      meta: `${auditLogs.length} recent entries`,
    });
  }

  if (canEditSettings) {
    quickActions.push({
      segment: "settings",
      eyebrow: "Settings",
      title: "Refresh organization details",
      description:
        "Update branding, contact information, and renter-facing details from a dedicated editor.",
      meta: "Primary manager controls",
    });
  }

  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Overview"
        title="Jump to the work that matters"
        description="This workspace now keeps each management surface in its own section, so the fastest next step is always close at hand."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => (
            <WorkspaceQuickActionCard
              key={action.segment}
              eyebrow={action.eyebrow}
              title={action.title}
              description={action.description}
              meta={action.meta}
              onClick={() => openSection(action.segment)}
            />
          ))}
        </div>
      </SectionCard>

      <OrganizationBasicsCard
        detail={detail}
        membershipCount={membershipCount}
      />

      <OrganizationAboutCard organization={detail.organization} />
    </div>
  );
}
