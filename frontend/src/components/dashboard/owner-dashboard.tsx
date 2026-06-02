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
  FunnelCard,
  GranularitySelect,
  LoadingDashboard,
  MetricSelect,
  OutcomeBars,
  RestrictedState,
  StatCard,
  TrendChart,
  WindowSwitcher,
  type BucketMetricKey,
} from "@/components/dashboard/analytics-ui";
import {
  postingsAnalyticsApi,
  type OwnerPostingsAnalyticsSummary,
  type PostingAnalyticsDetail,
  type PostingAnalyticsListResult,
  type PostingAnalyticsWindow,
} from "@/lib/postings/analytics";

const PAGE_SIZE = 20;

export function OwnerDashboard() {
  const router = useRouter();
  const { status, session } = useAuth();
  const [windowValue, setWindowValue] = useState<PostingAnalyticsWindow>("7d");
  const [page, setPage] = useState(1);
  const [metricKey, setMetricKey] = useState<BucketMetricKey>("views");
  const [granularity, setGranularity] = useState<"hour" | "day">("day");
  const [selectedPostingId, setSelectedPostingId] = useState<string | null>(
    null,
  );
  const [summary, setSummary] = useState<OwnerPostingsAnalyticsSummary | null>(
    null,
  );
  const [listing, setListing] = useState<PostingAnalyticsListResult | null>(
    null,
  );
  const [detail, setDetail] = useState<PostingAnalyticsDetail | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
    if (status !== "authenticated" || !session || !canReadDashboard) {
      return;
    }

    let active = true;

    async function loadOverview(isPolling = false) {
      if (!isPolling) {
        setLoadingOverview(true);
      } else {
        setRefreshing(true);
      }

      try {
        const [nextSummary, nextListing] = await Promise.all([
          postingsAnalyticsApi.getOwnerSummary(windowValue),
          postingsAnalyticsApi.listOwnerPostings({
            window: windowValue,
            page,
            pageSize: PAGE_SIZE,
          }),
        ]);

        if (!active) {
          return;
        }

        startTransition(() => {
          setSummary(nextSummary);
          setListing(nextListing);
          setOverviewError(null);
          setLastUpdatedAt(new Date().toISOString());

          const currentStillVisible = nextListing.postings.some(
            (posting) => posting.postingId === selectedPostingId,
          );

          if (!currentStillVisible) {
            setSelectedPostingId(nextListing.postings[0]?.postingId ?? null);
          }
        });
      } catch (error) {
        if (active) {
          setOverviewError(
            error instanceof Error
              ? error.message
              : "Analytics could not be loaded.",
          );
        }
      } finally {
        if (active) {
          setLoadingOverview(false);
          setRefreshing(false);
        }
      }
    }

    void loadOverview();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadOverview(true);
      }
    }, DASHBOARD_POLL_INTERVAL_MS);

    const handleFocus = () => {
      void loadOverview(true);
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    canReadDashboard,
    page,
    router,
    selectedPostingId,
    session,
    status,
    windowValue,
  ]);

  useEffect(() => {
    if (status !== "authenticated" || !session || !canReadDashboard) {
      return;
    }

    if (!selectedPostingId) {
      setDetail(null);
      return;
    }

    const resolvedPostingId = selectedPostingId;

    let active = true;

    async function loadDetail(isPolling = false) {
      if (!isPolling) {
        setLoadingDetail(true);
      } else {
        setRefreshing(true);
      }

      try {
        const nextDetail = await postingsAnalyticsApi.getPostingDetail(
          resolvedPostingId,
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
          setDetailError(null);
          setLastUpdatedAt(new Date().toISOString());
        });
      } catch (error) {
        if (active) {
          setDetailError(
            error instanceof Error
              ? error.message
              : "Trend data could not be loaded.",
          );
        }
      } finally {
        if (active) {
          setLoadingDetail(false);
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
  }, [
    canReadDashboard,
    granularity,
    router,
    selectedPostingId,
    session,
    status,
    windowValue,
  ]);

  const selectedPosting = useMemo(
    () =>
      listing?.postings.find(
        (posting) => posting.postingId === selectedPostingId,
      ) ?? null,
    [listing, selectedPostingId],
  );

  const topCtrPosting = useMemo(() => {
    return listing?.postings
      .filter((posting) => posting.totals.searchImpressions > 0)
      .sort(
        (left, right) => right.derivedMetrics.ctr - left.derivedMetrics.ctr,
      )[0];
  }, [listing]);

  const topConfirmedPosting = useMemo(() => {
    return listing?.postings
      .slice()
      .sort(
        (left, right) =>
          right.totals.confirmedBookings - left.totals.confirmedBookings,
      )[0];
  }, [listing]);

  const needsAttentionPosting = useMemo(() => {
    return listing?.postings.find(
      (posting) =>
        posting.totals.views >= 10 &&
        posting.totals.bookingRequests === 0 &&
        posting.totals.confirmedBookings === 0,
    );
  }, [listing]);

  if (
    status === "loading" ||
    (status === "anonymous" && !session) ||
    loadingOverview
  ) {
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
        <section className="overflow-hidden rounded-[2.2rem] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.08)]">
          <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_34%),linear-gradient(135deg,_#ffffff,_#eff6ff)] px-6 py-7 sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
                  Owner dashboard
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950">
                  Watch your listing funnel move in real time
                </h1>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Search visibility, clicks, requests, approvals, confirmations,
                  and revenue all land here so you can see where each posting is
                  gaining momentum or leaking demand.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <WindowSwitcher value={windowValue} onChange={setWindowValue} />
                <FreshnessBadge
                  lastUpdatedAt={lastUpdatedAt}
                  refreshing={refreshing}
                />
              </div>
            </div>
          </div>
        </section>

        {overviewError ? (
          <div className="mt-6">
            <ErrorState
              title="Analytics overview could not be loaded"
              description={overviewError}
              action={
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-xl bg-rose-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Refresh page
                </button>
              }
            />
          </div>
        ) : null}

        {!overviewError &&
        summary &&
        listing &&
        listing.postings.length === 0 ? (
          <div className="mt-6">
            <EmptyAnalyticsState
              title="No owner analytics yet"
              description="Publish a few postings and let them collect search exposure, views, and booking requests. This dashboard will start filling in as soon as the marketplace has activity to measure."
            />
          </div>
        ) : null}

        {!overviewError && summary && listing && listing.postings.length > 0 ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard
                eyebrow="Impressions"
                value={formatCompactNumber(summary.totals.searchImpressions)}
                detail="How often your postings were surfaced in public search results."
                accent="from-sky-500 to-cyan-400"
                sparklineValues={detail?.buckets.map(
                  (bucket) => bucket.metrics.searchImpressions,
                )}
              />
              <StatCard
                eyebrow="Search Clicks"
                value={formatCompactNumber(summary.totals.searchClicks)}
                detail={`${formatPercent(summary.derivedMetrics.ctr)} click-through rate from search impression to click.`}
                accent="from-cyan-500 to-emerald-400"
                sparklineValues={detail?.buckets.map(
                  (bucket) => bucket.metrics.searchClicks,
                )}
              />
              <StatCard
                eyebrow="Booking Requests"
                value={formatCompactNumber(summary.totals.bookingRequests)}
                detail={`${formatPercent(summary.derivedMetrics.viewToRequestRate)} of listing views turn into requests.`}
                accent="from-amber-500 to-orange-400"
                sparklineValues={detail?.buckets.map(
                  (bucket) => bucket.metrics.bookingRequests,
                )}
              />
              <StatCard
                eyebrow="Confirmed Bookings"
                value={formatCompactNumber(summary.totals.confirmedBookings)}
                detail={`${formatPercent(summary.derivedMetrics.requestToConfirmedRate)} of requests make it all the way to confirmed rentings.`}
                accent="from-fuchsia-500 to-rose-400"
                sparklineValues={detail?.buckets.map(
                  (bucket) => bucket.metrics.confirmedBookings,
                )}
              />
              <StatCard
                eyebrow="Confirmed Revenue"
                value={formatMoney(summary.totals.estimatedConfirmedRevenue)}
                detail={`${formatMoney(summary.totals.refundedRevenue)} refunded in the current window.`}
                accent="from-slate-950 to-slate-700"
                sparklineValues={detail?.buckets.map(
                  (bucket) => bucket.metrics.estimatedConfirmedRevenue,
                )}
              />
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <AnalyticsCard
                title="Selected posting trend"
                subtitle={
                  selectedPosting
                    ? `${selectedPosting.name} · ${formatStatus(selectedPosting.status)}`
                    : "Choose a posting below to inspect live movement."
                }
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <MetricSelect value={metricKey} onChange={setMetricKey} />
                    <GranularitySelect
                      value={windowValue === "7d" ? granularity : "day"}
                      onChange={setGranularity}
                      disabled={windowValue !== "7d"}
                    />
                    {selectedPosting ? (
                      <Link
                        href={`/dashboard/postings/${selectedPosting.postingId}`}
                        className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Open detail
                      </Link>
                    ) : null}
                  </div>
                }
              >
                {detailError ? (
                  <ErrorState
                    title="Trend data is temporarily unavailable"
                    description={detailError}
                  />
                ) : loadingDetail && !detail ? (
                  <div className="h-72 rounded-[1.4rem] bg-slate-100" />
                ) : detail ? (
                  <TrendChart buckets={detail.buckets} metricKey={metricKey} />
                ) : (
                  <EmptyAnalyticsState
                    title="Pick a posting to unlock the live chart"
                    description="The overview stays aggregated, while the chart tracks one posting at a time so you can see its funnel move more clearly."
                  />
                )}
              </AnalyticsCard>

              <AnalyticsCard
                title="Conversion funnel"
                subtitle="This condenses marketplace discovery into a single owner-facing funnel."
              >
                <FunnelCard
                  metrics={selectedPosting?.totals ?? summary.totals}
                  derivedMetrics={
                    selectedPosting?.derivedMetrics ?? summary.derivedMetrics
                  }
                />
              </AnalyticsCard>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-3">
              <AnalyticsCard
                title="Top movers"
                subtitle="Quick reads on momentum and drag."
              >
                <div className="space-y-3">
                  <MoverCard
                    label="Best CTR"
                    posting={topCtrPosting}
                    value={
                      topCtrPosting
                        ? formatPercent(topCtrPosting.derivedMetrics.ctr)
                        : "—"
                    }
                  />
                  <MoverCard
                    label="Most confirmations"
                    posting={topConfirmedPosting}
                    value={
                      topConfirmedPosting
                        ? formatCompactNumber(
                            topConfirmedPosting.totals.confirmedBookings,
                          )
                        : "—"
                    }
                  />
                  <MoverCard
                    label="Needs attention"
                    posting={needsAttentionPosting}
                    value={
                      needsAttentionPosting
                        ? `${formatCompactNumber(needsAttentionPosting.totals.views)} views`
                        : "Healthy"
                    }
                  />
                </div>
              </AnalyticsCard>

              <AnalyticsCard
                title="Needs attention"
                subtitle="These diagnostics help explain where conversion is dropping."
              >
                <DiagnosticsList
                  items={buildDashboardDiagnostics(
                    selectedPosting?.totals ?? summary.totals,
                  )}
                />
              </AnalyticsCard>

              <AnalyticsCard
                title="Request outcomes"
                subtitle="Approvals are only part of the story. Outcome mix helps surface friction after inquiry."
              >
                <OutcomeBars
                  metrics={selectedPosting?.totals ?? summary.totals}
                />
              </AnalyticsCard>
            </section>

            <section className="mt-6">
              <AnalyticsCard
                title="Posting performance"
                subtitle="Use this list to switch the chart focus and compare conversion at a glance."
              >
                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200">
                  <div className="hidden grid-cols-[minmax(0,2fr)_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 md:grid">
                    <span>Posting</span>
                    <span>CTR</span>
                    <span>Requests</span>
                    <span>Confirmed</span>
                    <span>Utilization</span>
                    <span>Revenue</span>
                  </div>

                  <div className="divide-y divide-slate-200 bg-white">
                    {listing.postings.map((posting) => {
                      const isSelected =
                        posting.postingId === selectedPostingId;

                      return (
                        <button
                          key={posting.postingId}
                          type="button"
                          onClick={() =>
                            setSelectedPostingId(posting.postingId)
                          }
                          className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr] ${
                            isSelected ? "bg-sky-50/60" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-14 w-14 overflow-hidden rounded-2xl bg-slate-100">
                              {posting.primaryPhotoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={posting.primaryPhotoUrl}
                                  alt={posting.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">
                                {posting.name}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatStatus(posting.status)}
                              </p>
                            </div>
                          </div>
                          <MetricCell
                            label="CTR"
                            value={formatPercent(posting.derivedMetrics.ctr)}
                          />
                          <MetricCell
                            label="Requests"
                            value={formatCompactNumber(
                              posting.totals.bookingRequests,
                            )}
                          />
                          <MetricCell
                            label="Confirmed"
                            value={formatCompactNumber(
                              posting.totals.confirmedBookings,
                            )}
                          />
                          <MetricCell
                            label="Utilization"
                            value={formatPercent(
                              posting.derivedMetrics.utilizationRate,
                            )}
                          />
                          <MetricCell
                            label="Revenue"
                            value={formatMoney(
                              posting.totals.estimatedConfirmedRevenue,
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-500">
                    Page {listing.pagination.page} of{" "}
                    {listing.pagination.totalPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                      disabled={!listing.pagination.hasPreviousPage}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPage((current) =>
                          listing.pagination.hasNextPage
                            ? current + 1
                            : current,
                        )
                      }
                      disabled={!listing.pagination.hasNextPage}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </AnalyticsCard>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function MoverCard({
  label,
  posting,
  value,
}: {
  label: string;
  posting?: PostingAnalyticsListResult["postings"][number];
  value: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.04em] text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {posting?.name ?? "No posting has enough data yet."}
      </p>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 md:hidden">
        {label}
      </p>
      <p className="text-sm font-medium text-slate-700 md:pt-1">{value}</p>
    </div>
  );
}
