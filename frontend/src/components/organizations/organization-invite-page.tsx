"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type PreviewOrganizationInviteResult,
} from "@/lib/organizations/api";

interface OrganizationInvitePageProps {
  token: string;
}

function formatRole(role: string): string {
  return role
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function OrganizationInvitePage({ token }: OrganizationInvitePageProps) {
  const router = useRouter();
  const { status, session, setSession } = useAuth();
  const [preview, setPreview] =
    useState<PreviewOrganizationInviteResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextPath = `/organizations/invitations/${encodeURIComponent(token)}`;

  useEffect(() => {
    let active = true;

    async function loadPreview() {
      setLoading(true);
      setError(null);

      try {
        const nextPreview = await organizationsApi.previewInvite(token);

        if (!active) {
          return;
        }

        startTransition(() => {
          setPreview(nextPreview);
        });
      } catch (nextError) {
        if (active) {
          setError(
            getApiErrorMessage(nextError, {
              action: "load this invitation",
              fallback:
                "We couldn't load this invitation right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      active = false;
    };
  }, [status, token]);

  async function handleAccept() {
    setPending(true);
    setError(null);

    try {
      await organizationsApi.acceptInvite(token);
      const refreshedSession = await authApi.refresh();

      if (refreshedSession) {
        setSession(refreshedSession);
      }

      router.replace("/organizations");
    } catch (nextError) {
      setError(
        getApiErrorMessage(nextError, {
          action: "accept this invitation",
          fallback:
            "We couldn't accept this invitation right now. Please try again.",
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 px-6 py-12 text-slate-900">
        <div className="mx-auto max-w-3xl text-sm font-medium text-slate-500">
          Loading invitation...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Organization invite
        </p>

        {error && !preview ? (
          <>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
              Invitation unavailable
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-600">{error}</p>
            <div className="mt-6">
              <Link
                href="/organizations"
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Back to organizations
              </Link>
            </div>
          </>
        ) : null}

        {preview ? (
          <>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
              Join {preview.invitation.organizationName}
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              You have been invited as a{" "}
              <span className="font-semibold text-slate-950">
                {formatRole(preview.invitation.role)}
              </span>
              . This invite was sent to {preview.invitation.emailHint} and
              expires on {formatDate(preview.invitation.expiresAt)}.
            </p>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
              Status:{" "}
              <span className="font-semibold text-slate-950">
                {preview.invitation.status}
              </span>
            </div>

            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            {preview.invitation.status !== "pending" ? (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-600">
                This invite is no longer active. If you still need access, ask
                the organization manager to send a fresh invitation.
              </div>
            ) : null}

            {preview.invitation.status === "pending" &&
            status === "anonymous" ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-600">
                  Sign in or create an account with the invited email address to
                  accept this invitation.
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/login?next=${encodeURIComponent(nextPath)}`}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Sign in
                  </Link>
                  <Link
                    href={`/signup?next=${encodeURIComponent(nextPath)}`}
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Create account
                  </Link>
                </div>
              </div>
            ) : null}

            {preview.invitation.status === "pending" &&
            status === "authenticated" ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-600">
                  <p>
                    Signed in as{" "}
                    <span className="font-semibold text-slate-950">
                      {session?.user.email}
                    </span>
                  </p>
                  {!preview.viewer.matchesEmail ? (
                    <p className="mt-2">
                      This invite was sent to a different email address. Sign in
                      with the invited email to continue.
                    </p>
                  ) : null}
                  {preview.viewer.matchesEmail && !preview.viewer.canAccept ? (
                    <p className="mt-2">
                      This account still needs a verified email address before
                      it can accept the invitation.
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleAccept()}
                    disabled={!preview.viewer.canAccept || pending}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? "Accepting..." : "Accept invitation"}
                  </button>

                  {!preview.viewer.matchesEmail ? (
                    <Link
                      href={`/login?next=${encodeURIComponent(nextPath)}`}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Switch account
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
