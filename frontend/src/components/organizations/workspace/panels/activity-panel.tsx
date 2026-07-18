"use client";

import Link from "next/link";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/organizations/shared/styles";
import {
  formatAuditAction,
  formatDateTime,
} from "@/components/organizations/shared/format";
import { SectionCard } from "@/components/organizations/shared/primitives";
import { useOrganizationWorkspace } from "@/components/organizations/workspace/workspace-provider";

export function ActivityPanel() {
  const {
    auditLogs,
    auditLoading,
    auditError,
    restoringAuditId,
    handleRestoreAudit,
  } = useOrganizationWorkspace();

  return (
    <div className="space-y-6">
      <SectionCard
        eyebrow="Audit trail"
        title="Recent organization activity"
        description="Review manager actions, posting changes, and restorable versions."
        action={
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {auditLogs.length} recent
          </span>
        }
      >
        {auditLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-20 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
              />
            ))}
          </div>
        ) : auditError ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {auditError}
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No audited activity yet.
          </div>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-start lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950 dark:text-white">
                      {formatAuditAction(entry.action)}
                    </p>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {entry.resourceType.replaceAll("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      v{entry.organizationVersion}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {entry.summary}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {entry.actor?.username ?? "System"} /{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.changes.length > 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Changed{" "}
                      {entry.changes
                        .slice(0, 4)
                        .map((change) => change.field)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                {entry.restorable ? (
                  <button
                    type="button"
                    onClick={() => void handleRestoreAudit(entry.id)}
                    disabled={restoringAuditId === entry.id}
                    className={secondaryButtonClass}
                  >
                    {restoringAuditId === entry.id ? "Restoring..." : "Restore"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <section className="rounded-[1.8rem] border border-amber-200 bg-[linear-gradient(135deg,rgba(247,241,231,0.92),rgba(255,255,255,0.98))] p-6 sm:p-7 dark:border-amber-900/50 dark:bg-[linear-gradient(135deg,rgba(69,52,28,0.36),rgba(15,23,42,0.9))]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
              Analytics and payouts
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
              Track performance in the owner dashboard
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Postings are managed here per organization. Performance analytics
              and payout ownership still live in the owner dashboard for now.
            </p>
          </div>
          <Link href="/dashboard" className={`${primaryButtonClass} shrink-0`}>
            Open owner dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
