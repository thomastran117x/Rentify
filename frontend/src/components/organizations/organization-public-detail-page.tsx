"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type PublicOrganizationDetailResult,
} from "@/lib/organizations/api";

interface OrganizationPublicDetailPageProps {
  id: string;
}

function formatLocation(
  organization: PublicOrganizationDetailResult["organization"],
): string | null {
  const parts = [
    organization.addressLine1,
    organization.city,
    organization.region,
    organization.country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function OrganizationPublicDetailPage({
  id,
}: OrganizationPublicDetailPageProps) {
  const [result, setResult] =
    useState<PublicOrganizationDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadOrganization() {
      setLoading(true);
      setError(null);

      try {
        const nextResult = await organizationsApi.getPublicById(id);

        if (!active) {
          return;
        }

        setResult(nextResult);
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(
          getApiErrorMessage(nextError, {
            action: "load this organization",
            fallback:
              "We couldn't load this organization right now. Please try again.",
          }),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadOrganization();

    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 dark:bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.18),_transparent_28%),linear-gradient(180deg,_#020617,_#0f172a)]">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="h-16 w-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-72 animate-pulse rounded-[2rem] bg-slate-200 dark:bg-slate-800" />
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-36 animate-pulse rounded-[1.6rem] bg-slate-200 dark:bg-slate-800"
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (error || !result) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900 dark:bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.18),_transparent_28%),linear-gradient(180deg,_#020617,_#0f172a)] dark:text-white">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_28px_80px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            Public organization detail
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
            Organization unavailable
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {error ??
              "This organization could not be found or does not currently have published postings."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/organizations"
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-violet-700 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-100"
            >
              Back to directory
            </Link>
            <Link
              href="/dashboard/organizations"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
            >
              Open workspace
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { organization, stats } = result;
  const location = formatLocation(organization);
  const customFields = Object.entries(organization.customFields ?? {});

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900 dark:bg-[radial-gradient(circle_at_top_right,_rgba(124,58,237,0.18),_transparent_28%),linear-gradient(180deg,_#020617,_#0f172a)] dark:text-white">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/organizations"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
          >
            Back to directory
          </Link>
          <Link
            href="/dashboard/organizations"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-100"
          >
            Open workspace
          </Link>
        </div>

        <section className="overflow-hidden rounded-[2.2rem] border border-slate-200 bg-white/90 p-8 shadow-[0_32px_90px_rgba(15,23,42,0.08)] backdrop-blur sm:p-10 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/40">
          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
            <div>
              <p className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300">
                Public organization profile
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-5xl dark:text-white">
                {organization.name}
              </h1>
              <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
                {organization.description ??
                  "This organization has active public marketplace listings on Rentify."}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {location ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {location}
                  </span>
                ) : null}
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Listed since {formatDate(organization.createdAt)}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Updated {formatDate(organization.updatedAt)}
                </span>
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-950/60">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                Public stats
              </p>
              <p className="mt-3 text-5xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
                {stats.publishedPostingCount}
              </p>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                Published posting{stats.publishedPostingCount === 1 ? "" : "s"} currently tied to this organization.
              </p>
              {organization.websiteUrl ? (
                <a
                  href={organization.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
                >
                  Visit website
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Website
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {organization.websiteUrl ? (
                <a
                  href={organization.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-violet-700 transition hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
                >
                  {organization.websiteUrl}
                </a>
              ) : (
                "No public website shared."
              )}
            </p>
          </div>
          <div className="rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Address
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {location ?? "No public address shared."}
            </p>
          </div>
          <div className="rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Public profile data
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Contact email, phone, team membership, invitations, and audit history stay private to workspace members.
            </p>
          </div>
        </section>

        {customFields.length > 0 ? (
          <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
              Additional profile details
            </h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {customFields.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {key}
                  </dt>
                  <dd className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-200">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>
    </main>
  );
}
