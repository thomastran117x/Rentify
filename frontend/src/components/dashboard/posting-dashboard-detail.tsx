"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { canReadOrganizationPostings } from "@/lib/auth/roles";
import {
  AnalyticsCard,
  buildDashboardDiagnostics,
  DASHBOARD_POLL_INTERVAL_MS,
  DiagnosticsList,
  EmptyAnalyticsState,
  ErrorState,
  formatCompactNumber,
  formatMoney,
  formatPercent,
  formatStatus,
  FreshnessBadge,
  GranularitySelect,
  LoadingDashboard,
  MetricSelect,
  OutcomeBars,
  RestrictedState,
  TrendChart,
  WindowSwitcher,
  type BucketMetricKey,
} from "@/components/dashboard/analytics-ui";
import {
  postingsAnalyticsApi,
  type PostingAnalyticsDetail,
  type PostingAnalyticsWindow,
} from "@/lib/postings/analytics";

export function PostingDashboardDetail({ postingId }: { postingId: string }) {
  const router = useRouter();
  const { status, session } = useAuth();
  const [windowValue, setWindowValue] = useState<PostingAnalyticsWindow>("7d");
  const [granularity, setGranularity] = useState<"hour" | "day">("day");
  const [metricKey, setMetricKey] = useState<BucketMetricKey>("views");
  const [detail, setDetail] = useState<PostingAnalyticsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | undefined>(
    undefined,
  );
  const canReadDashboard = canReadOrganizationPostings(
    session?.user.activeOrganization,
  );

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (windowValue !== "7d" && granularity !== "day") {
      setGranularity("day");
    }
  }, [granularity, windowValue]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      !session ||
      !canReadDashboard
    ) {
      return;
    }

    let active = true;

    async function loadDetail(isPolling = false) {
      if (!isPolling) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const nextDetail = await postingsAnalyticsApi.getPostingDetail(
          postingId,
          {
            window: windowValue,
            granularity: windowValue === "7d" ? granularity : "day",
          },
        );

        if (!active) {
          return;
        }

        startTransition(() => {
          setDetail(nextDetail);
          setError(null);
          setLastUpdatedAt(new Date().toISOString());
        });
      } catch (nextError) {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Posting analytics could not be loaded.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadDetail();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDetail(true);
      }
    }, DASHBOARD_POLL_INTERVAL_MS);

    const handleFocus = () => {
      void loadDetail(true);
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [canReadDashboard, granularity, postingId, router, session, status, windowValue]);

  const diagnostics = useMemo(
    () => (detail ? buildDashboardDiagnostics(detail.totals) : []),
    [detail],
  );

  if (status === "loading" || loading) {
    return <LoadingDashboard />;
  }

  if (!session) {
    return <LoadingDashboard />;
  }

  if (!canReadDashboard) {
    return <RestrictedState />;
  }

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-slate-500 transition hover:text-slate-950"
          >
            ← Back to dashboard
          </Link>
        </div>

        {error ? (
          <ErrorState
            title="Posting analytics could not be loaded"
            description={error}
          />
        ) : null}

        {!error && !detail ? (
          <EmptyAnalyticsState
            title="No analytics found for this posting"
            description="This usually means the posting has not collected enough activity yet, or it is no longer available in your owner analytics view."
          />
        ) : null}

        {!error && detail ? (
          <>
            <section className="overflow-hidden rounded-[2.2rem] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.08)]">
              <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="relative min-h-56 bg-slate-100">
                  {detail.primaryPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={detail.primaryPhotoUrl}
                      alt={detail.name}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,_#e2e8f0,_#f8fafc)]" />
                  )}
                </div>
                <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_34%),linear-gradient(135deg,_#ffffff,_#eff6ff)] px-6 py-7">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-3xl">
                      <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
                        Posting detail
                      </p>
                      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950">
                        {detail.name}
                      </h1>
                      <p className="mt-3 text-sm text-slate-500">
                        {formatStatus(detail.status)}
                      </p>
                      <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-600">
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                          {formatCompactNumber(detail.totals.searchImpressions)}{" "}
                          impressions
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                          {formatCompactNumber(detail.totals.bookingRequests)}{" "}
                          requests
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                          {formatCompactNumber(detail.totals.confirmedBookings)}{" "}
                          confirmed
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                          {formatMoney(detail.totals.estimatedConfirmedRevenue)}{" "}
                          revenue
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <WindowSwitcher
                        value={windowValue}
                        onChange={setWindowValue}
                      />
                      <FreshnessBadge
                        lastUpdatedAt={lastUpdatedAt}
                        refreshing={refreshing}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <AnalyticsCard
                title="Live trend"
                subtitle="Switch metrics to inspect where this posting is attracting attention or losing conversion."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <MetricSelect value={metricKey} onChange={setMetricKey} />
                    <GranularitySelect
                      value={windowValue === "7d" ? granularity : "day"}
                      onChange={setGranularity}
                      disabled={windowValue !== "7d"}
                    />
                  </div>
                }
              >
                <TrendChart buckets={detail.buckets} metricKey={metricKey} />
              </AnalyticsCard>

              <AnalyticsCard
                title="Posting diagnostics"
                subtitle="These reads turn raw activity into next-step hints."
              >
                <DiagnosticsList items={diagnostics} />
              </AnalyticsCard>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-3">
              <AnalyticsCard
                title="Traffic and conversion"
                subtitle="Core metrics for discovery and demand."
              >
                <div className="grid gap-3">
                  <MetricRow
                    label="CTR"
                    value={formatPercent(detail.derivedMetrics.ctr)}
                  />
                  <MetricRow
                    label="View to request"
                    value={formatPercent(
                      detail.derivedMetrics.viewToRequestRate,
                    )}
                  />
                  <MetricRow
                    label="Request to approval"
                    value={formatPercent(
                      detail.derivedMetrics.requestToApprovalRate,
                    )}
                  />
                  <MetricRow
                    label="Request to confirmed"
                    value={formatPercent(
                      detail.derivedMetrics.requestToConfirmedRate,
                    )}
                  />
                </div>
              </AnalyticsCard>

              <AnalyticsCard
                title="Revenue and utilization"
                subtitle="Operational context beyond raw bookings."
              >
                <div className="grid gap-3">
                  <MetricRow
                    label="Confirmed revenue"
                    value={formatMoney(detail.totals.estimatedConfirmedRevenue)}
                  />
                  <MetricRow
                    label="Refunded revenue"
                    value={formatMoney(detail.totals.refundedRevenue)}
                  />
                  <MetricRow
                    label="Avg revenue / confirmed booking"
                    value={formatMoney(
                      detail.derivedMetrics.averageRevenuePerConfirmedBooking,
                    )}
                  />
                  <MetricRow
                    label="Utilization"
                    value={formatPercent(detail.derivedMetrics.utilizationRate)}
                  />
                  <MetricRow
                    label="Booked days"
                    value={formatCompactNumber(
                      detail.totals.confirmedBookedDays,
                    )}
                  />
                </div>
              </AnalyticsCard>

              <AnalyticsCard
                title="Request outcomes"
                subtitle="Where approved demand is falling away after inquiry."
              >
                <OutcomeBars metrics={detail.totals} />
              </AnalyticsCard>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}
