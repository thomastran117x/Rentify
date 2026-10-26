"use client";

import { useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { adminSecurityApi } from "@/lib/admin-security/api";
import { isNotFoundError } from "@/lib/admin-security/format";
import type { AuthIpBlock } from "@/lib/admin-security/types";
import { formatAbsoluteTime } from "@/lib/security-activity/format";

type LoadResult =
  | { requestKey: number; kind: "ready"; items: AuthIpBlock[] }
  | { requestKey: number; kind: "error"; message: string };

interface AdminIpBlocksPanelProps {
  /** Changes when the page refreshes, which reloads the list too. */
  refreshKey: number;
  /** Called after an unblock, whose audit event the events table can show. */
  onUnblocked: () => void;
}

/**
 * The addresses credential-stuffing detection has kept off sign-in, with an
 * Unblock button for each. A block also lifts on its own at its expiry, so
 * the list is a snapshot; Unblock on one that already lifted just drops it.
 */
export function AdminIpBlocksPanel({
  refreshKey,
  onUnblocked,
}: AdminIpBlocksPanelProps) {
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = refreshKey * 1_000 + reloadCount;
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pendingIp, setPendingIp] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    adminSecurityApi
      .listIpBlocks(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ requestKey, kind: "ready", items: data.items });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            requestKey,
            kind: "error",
            message: getApiErrorMessage(error, {
              action: "load blocked IP addresses",
              fallback:
                "We couldn't load blocked IP addresses right now. Please try again.",
            }),
          });
        }
      });

    return () => controller.abort();
  }, [requestKey]);

  const loading = result?.requestKey !== requestKey;

  async function unblock(ipAddress: string) {
    setPendingIp(ipAddress);
    setNotice(null);
    setActionError(null);

    try {
      await adminSecurityApi.unblockIp(ipAddress);
      setNotice(`${ipAddress} is unblocked.`);
      onUnblocked();
    } catch (error) {
      if (isNotFoundError(error)) {
        setNotice(`${ipAddress} was no longer blocked.`);
      } else {
        setActionError(
          getApiErrorMessage(error, {
            action: "unblock this IP address",
            fallback: "We couldn't unblock this IP address. Please try again.",
          }),
        );
        return;
      }
    } finally {
      setPendingIp(null);
    }

    setReloadCount((value) => value + 1);
  }

  return (
    <section
      aria-labelledby="admin-ip-blocks-heading"
      className="grid gap-4 rounded-[1.5rem] border border-slate-200 p-4 dark:border-slate-800"
    >
      <div>
        <h2
          id="admin-ip-blocks-heading"
          className="text-lg font-semibold text-slate-950 dark:text-white"
        >
          Blocked IP addresses
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Addresses suspicious-activity detection has kept off sign-in after a
          credential-stuffing burst. Each block lifts on its own.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <div
          role="status"
          aria-label="Loading blocked IP addresses"
          className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
        />
      ) : result?.kind === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-rose-300 px-4 py-4 text-sm text-rose-700 dark:border-rose-800 dark:text-rose-300 sm:flex-row sm:items-center sm:justify-between"
        >
          <p>{result.message}</p>
          <button
            type="button"
            onClick={() => setReloadCount((value) => value + 1)}
            className="shrink-0 rounded-full border border-rose-300 px-4 py-1.5 font-semibold transition hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/40"
          >
            Try again
          </button>
        </div>
      ) : result?.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          No IP addresses are blocked.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {result?.items.map((block) => (
            <li
              key={block.ipAddress}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="font-mono text-sm text-slate-900 dark:text-white">
                  {block.ipAddress}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Lifts{" "}
                  <time dateTime={block.expiresAt}>
                    {formatAbsoluteTime(block.expiresAt)}
                  </time>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void unblock(block.ipAddress)}
                disabled={pendingIp !== null}
                aria-label={`Unblock ${block.ipAddress}`}
                className="inline-flex h-9 items-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {pendingIp === block.ipAddress ? "Unblocking..." : "Unblock"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
