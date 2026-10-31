"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock3,
  Laptop,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  isApiClientError,
  type AuthSessionSummary,
  type RevokeAuthSessionsScope,
} from "@/lib/auth/types";

export interface SessionManagementPanelProps {
  onVerificationRequired?: () => void;
}

export function formatSessionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isVerificationRequired(error: unknown): boolean {
  return isApiClientError(error) && error.code === "MFA_VERIFICATION_REQUIRED";
}

function sessionDetails(session: AuthSessionSummary): string {
  return [session.browser, session.os, session.platform]
    .filter(
      (value, index, values): value is string =>
        Boolean(value) && values.indexOf(value) === index,
    )
    .join(" · ");
}

export function SessionManagementPanel({
  onVerificationRequired,
}: SessionManagementPanelProps) {
  const router = useRouter();
  const { clearSession } = useAuth();
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">(
    "success",
  );
  const [pending, setPending] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const handleError = useCallback(
    (error: unknown, action: string, fallback: string): boolean => {
      if (isVerificationRequired(error)) {
        onVerificationRequired?.();
        return true;
      }

      setMessageTone("error");
      setMessage(
        getApiErrorMessage(error, {
          action,
          fallback,
          preserveClientMessage: true,
        }),
      );
      return false;
    },
    [onVerificationRequired],
  );

  const loadSessions = useCallback(async () => {
    setStatus("loading");
    setMessage(null);

    try {
      const result = await authApi.listSessions();
      setSessions(result.sessions);
      setStatus("ready");
    } catch (error) {
      if (
        !handleError(
          error,
          "load your signed-in sessions",
          "We couldn't load your signed-in sessions right now.",
        )
      ) {
        setStatus("error");
      }
    }
  }, [handleError]);

  useEffect(() => {
    void Promise.resolve().then(loadSessions);
  }, [loadSessions]);

  function signOutLocally() {
    clearSession();
    router.replace("/login");
    router.refresh();
  }

  async function revokeSession(session: AuthSessionSummary) {
    setPending(`session:${session.id}`);
    setMessage(null);

    try {
      const result = await authApi.revokeSession(session.id);
      if (result.current) {
        signOutLocally();
        return;
      }

      setSessions((current) => current.filter((item) => item.id !== result.id));
      setMessageTone("success");
      setMessage(`${session.deviceLabel} was signed out.`);
    } catch (error) {
      handleError(
        error,
        "sign out that session",
        "We couldn't sign out that session right now. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }

  async function revokeSessions(scope: RevokeAuthSessionsScope) {
    setPending(scope);
    setMessage(null);

    try {
      const result = await authApi.revokeSessions(scope);
      if (scope === "all") {
        setConfirmAll(false);
        signOutLocally();
        return;
      }

      setSessions((current) => current.filter((session) => session.current));
      setMessageTone("success");
      setMessage(
        result.revokedSessionCount === 1
          ? "1 other session was signed out."
          : `${result.revokedSessionCount} other sessions were signed out.`,
      );
    } catch (error) {
      handleError(
        error,
        scope === "all"
          ? "sign out everywhere"
          : "sign out your other sessions",
        scope === "all"
          ? "We couldn't sign you out everywhere right now. Please try again."
          : "We couldn't sign out your other sessions right now. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }

  const otherSessionCount = sessions.filter(
    (session) => !session.current,
  ).length;
  const hasPendingAction = pending !== null;

  return (
    <section
      aria-labelledby="signed-in-sessions-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Laptop className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="signed-in-sessions-heading"
            className="text-lg font-semibold text-slate-950 dark:text-white"
          >
            Where you&apos;re signed in
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Review and end active sessions without removing registered devices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSessions()}
          disabled={status === "loading" || hasPendingAction}
          aria-label="Refresh signed-in sessions"
          title="Refresh"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw
            className={`h-4 w-4 ${status === "loading" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {message ? (
        <div
          role={messageTone === "error" ? "alert" : "status"}
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            messageTone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
          }`}
        >
          {message}
        </div>
      ) : null}

      {status === "loading" ? (
        <div
          role="status"
          className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading signed-in sessions...
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed border-rose-300 px-4 py-7 text-center dark:border-rose-900/70">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your session list is unavailable.
          </p>
          <button
            type="button"
            onClick={() => void loadSessions()}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Try again
          </button>
        </div>
      ) : null}

      {status === "ready" && sessions.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 px-4 py-7 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No active sessions found.
        </div>
      ) : null}

      {status === "ready" && sessions.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No signed-in sessions found.
        </div>
      ) : null}

      {status === "ready" && sessions.length > 0 ? (
        <div className="mt-5 grid gap-3">
          {sessions.map((session) => {
            const rowPending = pending === `session:${session.id}`;
            const details = sessionDetails(session);

            return (
              <article
                key={session.id}
                className={`rounded-xl border p-4 ${
                  session.current
                    ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-slate-950 dark:text-white">
                        {session.deviceLabel}
                      </h3>
                      {session.current ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          Current session
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {details || "Device details unavailable"}
                    </p>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-slate-700 dark:text-slate-300">
                          First IP
                        </dt>
                        <dd>{session.firstIpAddress ?? "Unavailable"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-700 dark:text-slate-300">
                          Latest IP
                        </dt>
                        <dd>{session.lastIpAddress ?? "Unavailable"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-700 dark:text-slate-300">
                          Signed in
                        </dt>
                        <dd>{formatSessionDate(session.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-700 dark:text-slate-300">
                          Last used
                        </dt>
                        <dd className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" aria-hidden="true" />
                          {formatSessionDate(session.lastUsedAt)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Remember me: {session.rememberMe ? "On" : "Off"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void revokeSession(session)}
                    disabled={hasPendingAction}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {rowPending ? (
                      <LoaderCircle
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {rowPending ? "Signing out..." : "Sign out"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void revokeSessions("others")}
          disabled={
            status !== "ready" || otherSessionCount === 0 || hasPendingAction
          }
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {pending === "others" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          {pending === "others"
            ? "Signing out others..."
            : "Sign out of all other sessions"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmAll(true)}
          disabled={status !== "ready" || hasPendingAction}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Sign out everywhere
        </button>
      </div>

      {confirmAll ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sign-out-everywhere-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="sign-out-everywhere-heading"
                  className="text-lg font-semibold text-slate-950 dark:text-white"
                >
                  Sign out everywhere?
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  This ends every session, including this one, and revokes all
                  personal access tokens. You&apos;ll need to sign in again on
                  every device and create new tokens for any integrations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                disabled={pending === "all"}
                aria-label="Close sign out everywhere confirmation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                disabled={pending === "all"}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void revokeSessions("all")}
                disabled={pending === "all"}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending === "all" ? (
                  <LoaderCircle
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {pending === "all" ? "Signing out..." : "Sign out everywhere"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
