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
  const parts = [organization.addressLine1, organization.city, organization.region, organization.country]
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
      <main className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc,_#fff7ed)] px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="h-16 w-48 animate-pulse rounded-2xl bg-stone-200" />
          <div className="h-72 animate-pulse rounded-[2rem] bg-stone-200" />
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-36 animate-pulse rounded-[1.6rem] bg-stone-200"
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (error || !result) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc,_#fff7ed)] px-6 py-10 text-stone-950">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-stone-200 bg-white p-8 shadow-[0_30px_90px_-60px_rgba(41,37,36,0.35)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
            Public organization detail
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-stone-950">
            Organization unavailable
          </h1>
          <p className="mt-4 text-sm leading-7 text-stone-600">
            {error ??
              "This organization could not be found or does not currently have published postings."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/organizations"
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-amber-700"
            >
              Back to directory
            </Link>
            <Link
              href="/dashboard/organizations"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-stone-200 bg-white px-5 text-sm font-semibold text-stone-700 transition hover:border-amber-300 hover:text-amber-700"
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.16),_transparent_28%),linear-gradient(180deg,_#fffaf1,_#ffffff_48%,_#f5f5f4)] px-6 py-10 text-stone-950">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/organizations"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:border-amber-300 hover:text-amber-700"
          >
            Back to directory
          </Link>
          <Link
            href="/dashboard/organizations"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            Open workspace
          </Link>
        </div>

        <section className="overflow-hidden rounded-[2.2rem] border border-stone-200 bg-white/90 p-8 shadow-[0_38px_120px_-70px_rgba(120,53,15,0.4)] backdrop-blur sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
            <div>
              <p className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                Public organization profile
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-stone-950 sm:text-5xl">
                {organization.name}
              </h1>
              <p className="mt-4 text-base leading-8 text-stone-600">
                {organization.description ??
                  "This organization has active public marketplace listings on Rentify."}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {location ? (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                    {location}
                  </span>
                ) : null}
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                  Listed since {formatDate(organization.createdAt)}
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                  Updated {formatDate(organization.updatedAt)}
                </span>
              </div>
            </div>

            <div className="rounded-[1.8rem] border border-stone-200 bg-stone-50 p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                Public stats
              </p>
              <p className="mt-3 text-5xl font-semibold tracking-[-0.05em] text-stone-950">
                {stats.publishedPostingCount}
              </p>
              <p className="mt-2 text-sm leading-7 text-stone-600">
                Published posting{stats.publishedPostingCount === 1 ? "" : "s"} currently tied to this organization.
              </p>
              {organization.websiteUrl ? (
                <a
                  href={organization.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-white px-4 text-sm font-semibold text-stone-700 transition hover:bg-amber-50 hover:text-amber-700"
                >
                  Visit website
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.6rem] border border-stone-200 bg-white p-6 shadow-[0_22px_70px_-55px_rgba(41,37,36,0.35)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Website
            </p>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              {organization.websiteUrl ? (
                <a
                  href={organization.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-amber-700 hover:text-amber-800"
                >
                  {organization.websiteUrl}
                </a>
              ) : (
                "No public website shared."
              )}
            </p>
          </div>
          <div className="rounded-[1.6rem] border border-stone-200 bg-white p-6 shadow-[0_22px_70px_-55px_rgba(41,37,36,0.35)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Address
            </p>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              {location ?? "No public address shared."}
            </p>
          </div>
          <div className="rounded-[1.6rem] border border-stone-200 bg-white p-6 shadow-[0_22px_70px_-55px_rgba(41,37,36,0.35)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Public profile data
            </p>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              Contact email, phone, team membership, invitations, and audit history stay private to workspace members.
            </p>
          </div>
        </section>

        {customFields.length > 0 ? (
          <section className="rounded-[1.8rem] border border-stone-200 bg-white p-6 shadow-[0_22px_70px_-55px_rgba(41,37,36,0.35)]">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-stone-950">
              Additional profile details
            </h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {customFields.map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                    {key}
                  </dt>
                  <dd className="mt-2 text-sm leading-7 text-stone-700">
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
