"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { adminSecurityApi } from "@/lib/admin-security/api";
import {
  filtersToSearchParams,
  isForbiddenError,
  readFiltersFromSearchParams,
  toListInput,
  validationMessage,
  type AdminSecurityFilters,
} from "@/lib/admin-security/format";
import type {
  AdminAuthAuditEventList,
  AuthAuditUserSummary,
} from "@/lib/admin-security/types";
import { formatAbsoluteTime } from "@/lib/security-activity/format";
import { AdminSecurityFilterBar } from "./admin-security-filter-bar";
import {
  AdminSecurityEventTable,
  AdminSecurityEventTableSkeleton,
} from "./admin-security-event-table";
import { AdminUserSecurityDrawer } from "./admin-user-security-drawer";

type LoadResult =
  | { requestKey: string; kind: "ready"; data: AdminAuthAuditEventList }
  | { requestKey: string; kind: "forbidden" }
  | { requestKey: string; kind: "error"; message: string };

function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-4 py-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.13),_transparent_28%),linear-gradient(180deg,_#020617,_#0b1120)] dark:text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">{children}</div>
    </main>
  );
}

/**
 * The admin sign-in activity view. Filters live in the URL so a search
 * survives a refresh and can be shared with another admin; the page cursor
 * does not, so a refresh returns to the newest events.
 *
 * Results are keyed by the request they answer, so a slow response for an
 * old search never overwrites a newer one and no loading flag has to be set
 * before each fetch.
 */
export function AdminSecurityWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const filters = useMemo(
    () => readFiltersFromSearchParams(new URLSearchParams(paramsKey)),
    [paramsKey],
  );

  // Cursors of the pages after the first, reset whenever the filters change.
  const [paging, setPaging] = useState({
    paramsKey,
    cursors: [] as string[],
  });
  const cursors = paging.paramsKey === paramsKey ? paging.cursors : [];
  const cursor = cursors.at(-1);

  const { session } = useAuth();
  const [refreshCount, setRefreshCount] = useState(0);
  const requestKey = `${paramsKey}|${cursor ?? ""}|${refreshCount}`;
  const [result, setResult] = useState<LoadResult | null>(null);
  const [selectedUser, setSelectedUser] = useState<AuthAuditUserSummary | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    adminSecurityApi
      .listEvents(toListInput(filters, cursor), controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ requestKey, kind: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (isForbiddenError(error)) {
          setResult({ requestKey, kind: "forbidden" });
          return;
        }

        const invalid = validationMessage(error);
        setResult({
          requestKey,
          kind: "error",
          message: invalid
            ? `Check the filters: ${invalid}`
            : getApiErrorMessage(error, {
                action: "load sign-in activity",
                fallback:
                  "We couldn't load sign-in activity right now. Please try again.",
              }),
        });
      });

    return () => controller.abort();
  }, [cursor, filters, requestKey]);

  const loading = result?.requestKey !== requestKey;

  function applyFilters(next: AdminSecurityFilters) {
    const query = filtersToSearchParams(next).toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function showUserEvents(user: AuthAuditUserSummary) {
    setSelectedUser(null);
    applyFilters({ ...filters, user: user.email });
  }

  if (result?.kind === "forbidden" && !loading) {
    return (
      <WorkspaceShell>
        <div
          role="alert"
          className="rounded-[1.8rem] border border-rose-200 bg-rose-50 px-6 py-6 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <p className="font-semibold">
            You don&apos;t have access to this page.
          </p>
          <p className="mt-1">
            Sign-in activity is limited to administrators because it shows other
            people&apos;s IP addresses and devices.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const data = result?.kind === "ready" && !loading ? result.data : null;

  return (
    <WorkspaceShell>
      <section className="grid gap-6 rounded-[2rem] border border-slate-200 bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
              Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
              Sign-in activity
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Search authentication events across every account. Every search
              and every account you open is recorded in the audit log.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshCount((value) => value + 1)}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw
              aria-hidden
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </header>

        <AdminSecurityFilterBar
          key={paramsKey}
          filters={filters}
          onApply={applyFilters}
          busy={loading}
        />

        {loading ? <AdminSecurityEventTableSkeleton /> : null}

        {result?.kind === "error" && !loading ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-rose-300 px-4 py-4 text-sm text-rose-700 dark:border-rose-800 dark:text-rose-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <p>{result.message}</p>
            <button
              type="button"
              onClick={() => setRefreshCount((value) => value + 1)}
              className="shrink-0 rounded-full border border-rose-300 px-4 py-1.5 font-semibold transition hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/40"
            >
              Try again
            </button>
          </div>
        ) : null}

        {data ? (
          <div className="grid gap-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Showing events from {formatAbsoluteTime(data.range.from)} to{" "}
              {formatAbsoluteTime(data.range.to)}
              {filters.fromDate || filters.toDate ? "" : " (last 7 days)"}.
            </p>

            {data.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {cursors.length > 0
                  ? "No more events."
                  : "No events match these filters."}
              </div>
            ) : (
              <AdminSecurityEventTable
                events={data.items}
                onOpenUser={setSelectedUser}
                // The credential-stuffing pivot: every account seen from
                // this address, so the account filter is dropped.
                onFilterByIp={(ip) =>
                  applyFilters({ ...filters, user: "", ip })
                }
              />
            )}

            <nav
              aria-label="Sign-in activity pages"
              className="flex items-center justify-between gap-3"
            >
              <button
                type="button"
                onClick={() =>
                  setPaging({ paramsKey, cursors: cursors.slice(0, -1) })
                }
                disabled={cursors.length === 0}
                className="inline-flex h-10 items-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Newer
              </button>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Page {cursors.length + 1}
              </span>
              <button
                type="button"
                onClick={() =>
                  data.nextCursor &&
                  setPaging({
                    paramsKey,
                    cursors: [...cursors, data.nextCursor],
                  })
                }
                disabled={!data.nextCursor}
                className="inline-flex h-10 items-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Older
              </button>
            </nav>
          </div>
        ) : null}
      </section>

      {selectedUser ? (
        <AdminUserSecurityDrawer
          key={selectedUser.id}
          user={selectedUser}
          viewerId={session?.user.id ?? null}
          onClose={() => setSelectedUser(null)}
          onShowEvents={showUserEvents}
          onStatusChanged={() => setRefreshCount((value) => value + 1)}
        />
      ) : null}
    </WorkspaceShell>
  );
}
