"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  ExternalLink,
  Globe,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type PublicOrganizationDetailResult,
} from "@/lib/organizations/api";
import {
  OrganizationLogo,
  formatOrganizationDate,
  getWebsiteHost,
} from "@/components/organizations/organization-public-visuals";
import { theme } from "@/styles/theme";

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

function PageChrome({ children }: { children: React.ReactNode }) {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />
      <div className={theme.marketplace.container}>{children}</div>
    </main>
  );
}

export function OrganizationPublicDetailPage({
  id,
}: OrganizationPublicDetailPageProps) {
  const [result, setResult] = useState<PublicOrganizationDetailResult | null>(
    null,
  );
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
      <PageChrome>
        <div className="space-y-5">
          <div className="h-5 w-40 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-64 animate-pulse rounded-[2rem] bg-slate-200 dark:bg-slate-800" />
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-36 animate-pulse rounded-[1.5rem] bg-slate-200 dark:bg-slate-800"
              />
            ))}
          </div>
        </div>
      </PageChrome>
    );
  }

  if (error || !result) {
    return (
      <PageChrome>
        <Link
          href="/organizations"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to directory
        </Link>
        <section className={`${theme.marketplace.resultsShell} mt-6`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl dark:text-white">
            Organization unavailable
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            {error ??
              "This organization could not be found or does not currently have published postings."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/organizations"
              className={theme.marketplace.primaryButton}
            >
              Back to directory
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/dashboard/organizations"
              className={theme.marketplace.paginationButton}
            >
              Open workspace
            </Link>
          </div>
        </section>
      </PageChrome>
    );
  }

  const { organization, stats } = result;
  const location = formatLocation(organization);
  const websiteHost = getWebsiteHost(organization.websiteUrl);
  const customFields = Object.entries(organization.customFields ?? {});

  return (
    <PageChrome>
      <Link
        href="/organizations"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to directory
      </Link>

      <section className={`${theme.marketplace.heroShell} mt-6`}>
        <div className={theme.marketplace.heroHeader}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-5">
              <div className="rounded-[1.5rem] bg-white p-1.5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                <OrganizationLogo
                  name={organization.name}
                  logoUrl={organization.logoUrl}
                  size="lg"
                />
              </div>
              <div className="min-w-0">
                <p className={theme.marketplace.eyebrow}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Public profile
                </p>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-4xl dark:text-white">
                  {organization.name}
                </h1>
              </div>
            </div>

            {organization.websiteUrl ? (
              <a
                href={organization.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className={`${theme.marketplace.primaryButton} shrink-0`}
              >
                Visit website
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : null}
          </div>

          <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 dark:text-slate-300">
            {organization.description ??
              "This organization has active public marketplace listings on Rentify."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {location ? (
              <span className={theme.marketplace.metaBadge}>
                <MapPin className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
                {location}
              </span>
            ) : null}
            {websiteHost ? (
              <span className={theme.marketplace.metaBadge}>
                <Globe className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
                {websiteHost}
              </span>
            ) : null}
            <span className={theme.marketplace.metaBadge}>
              <CalendarDays className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
              Listed since{" "}
              {formatOrganizationDate(organization.createdAt, "long")}
            </span>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className={theme.marketplace.utilityCard}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            <Building2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Published postings
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-slate-950 tabular-nums dark:text-white">
            {stats.publishedPostingCount}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Live posting{stats.publishedPostingCount === 1 ? "" : "s"} currently
            tied to this organization.
          </p>
        </div>

        <div className={theme.marketplace.utilityCard}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            <Globe className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Website
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {organization.websiteUrl ? (
              <a
                href={organization.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 break-all font-semibold text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
              >
                {websiteHost ?? organization.websiteUrl}
                <ExternalLink
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
              </a>
            ) : (
              "No public website shared."
            )}
          </p>
        </div>

        <div className={theme.marketplace.utilityCard}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            <MapPin className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Address
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {location ?? "No public address shared."}
          </p>
        </div>
      </section>

      <section className={`${theme.marketplace.resultsShell} mt-6`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
              What stays private
            </h2>
            <p className="mt-1.5 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Contact email, phone, team membership, invitations, and audit
              history stay private to workspace members.
            </p>
          </div>
        </div>

        {customFields.length > 0 ? (
          <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
              Additional profile details
            </h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {customFields.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <dt className={theme.marketplace.fieldLabel}>{key}</dt>
                  <dd className="mt-2 text-sm leading-7 text-slate-700 dark:text-slate-200">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>
    </PageChrome>
  );
}
