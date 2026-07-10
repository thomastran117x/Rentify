"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { authApi } from "@/lib/auth/api";
import { ApiError } from "@/lib/auth/types";
import { HomePasswordPanel } from "@/components/home/home-password-panel";

export function HomeSessionPanel() {
  const { status, session, clearSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleLogout() {
    setPending(true);
    setMessage(null);

    try {
      await authApi.logout();
      clearSession();
      setMessage("Logged out. You can retest Microsoft OAuth now.");
    } catch (error) {
      clearSession();

      if (error instanceof ApiError && error.status === 401) {
        setMessage(
          "The session was already expired, so local auth state was cleared.",
        );
        return;
      }

      setMessage("Logout request failed, but local auth state was cleared.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 lg:flex-row lg:items-start lg:justify-center">
      <section className="w-full max-w-xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.35)]">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
            Auth Test
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            Home
          </h1>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {status === "authenticated" && session
              ? `Signed in as ${session.user.email}.`
              : status === "loading"
                ? "Checking current session state."
                : "No active session found in local auth state."}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleLogout}
            disabled={pending || status === "loading"}
            className="inline-flex cursor-pointer items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-slate-700"
          >
            {pending ? "Logging out..." : "Log out"}
          </button>
        </div>

        {message ? (
          <p className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {message}
          </p>
        ) : null}
      </section>

      <HomePasswordPanel />
    </div>
  );
}
