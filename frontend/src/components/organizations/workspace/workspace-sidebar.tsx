"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  getAccessibleSections,
  type WorkspaceCounts,
} from "@/components/organizations/workspace/section-registry";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

export function WorkspaceSidebar() {
  const activeSegment = useSelectedLayoutSegment();
  const {
    detail,
    memberCount,
    inviteCount,
    postingsTotal,
    auditLogs,
    announcements,
    blogPosts,
  } = useOrganizationWorkspace();

  const sections = getAccessibleSections(detail?.viewerRole);
  const counts: WorkspaceCounts = {
    memberCount,
    inviteCount,
    postingsTotal,
    auditCount: auditLogs.length,
    announcementsCount: announcements.length,
    blogCount: blogPosts.length,
  };

  return (
    <nav
      aria-label="Organization workspace sections"
      className="lg:sticky lg:top-24"
    >
      <ul className="flex gap-2 overflow-x-auto rounded-[1.4rem] border border-slate-200 bg-white/90 p-2 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.35)] backdrop-blur lg:flex-col lg:overflow-visible dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/30 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => {
          const selected = activeSegment === section.segment;
          const Icon = section.icon;
          const meta = section.meta?.(counts) ?? null;
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <Link
                href={`/dashboard/organizations/${section.segment}`}
                aria-current={selected ? "page" : undefined}
                className={`flex min-w-[11rem] items-start gap-3 rounded-[1.1rem] px-3 py-2.5 transition lg:min-w-0 ${
                  selected
                    ? "bg-slate-950 text-white shadow-[0_16px_40px_-26px_rgba(15,23,42,0.75)] dark:bg-white dark:text-slate-950"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
                }`}
              >
                <Icon
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    selected
                      ? "text-white dark:text-slate-950"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {section.label}
                  </span>
                  {meta ? (
                    <span
                      className={`mt-0.5 block text-[11px] font-medium ${
                        selected
                          ? "text-slate-300 dark:text-slate-500"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {meta}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
