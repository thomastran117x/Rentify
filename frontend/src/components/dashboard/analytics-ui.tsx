"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  PostingAnalyticsBucket,
  PostingAnalyticsBucketMetrics,
  PostingAnalyticsDerivedMetrics,
  PostingAnalyticsMetrics,
  PostingAnalyticsWindow,
} from "@/lib/postings/analytics";

export const DASHBOARD_POLL_INTERVAL_MS = 15_000;

export type BucketMetricKey = keyof PostingAnalyticsBucketMetrics;

export const CHART_METRICS: Array<{
  key: BucketMetricKey;
  label: string;
  tone: string;
  formatter?: "money";
}> = [
  {
    key: "searchImpressions",
    label: "Impressions",
    tone: "from-sky-500 to-cyan-400",
  },
  {
    key: "searchClicks",
    label: "Search clicks",
    tone: "from-cyan-500 to-emerald-400",
  },
  { key: "views", label: "Listing views", tone: "from-indigo-500 to-sky-400" },
  {
    key: "bookingRequests",
    label: "Requests",
    tone: "from-amber-500 to-orange-400",
  },
  {
    key: "approvedRequests",
    label: "Approvals",
    tone: "from-emerald-500 to-lime-400",
  },
  {
    key: "confirmedBookings",
    label: "Confirmations",
    tone: "from-fuchsia-500 to-rose-400",
  },
  {
    key: "estimatedConfirmedRevenue",
    label: "Confirmed revenue",
    tone: "from-slate-950 dark:from-slate-100 to-slate-700 dark:to-slate-400",
    formatter: "money",
  },
  {
    key: "refundedRevenue",
    label: "Refunded revenue",
    tone: "from-rose-500 to-pink-400",
    formatter: "money",
  },
];

export function formatMetricLabel(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMoney(amount: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(rate: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: rate < 0.1 ? 1 : 0,
  }).format(rate);
}

export function formatTimestamp(value?: string): string {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatBucketLabel(bucket: PostingAnalyticsBucket): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(bucket.granularity === "hour" ? { hour: "numeric" as const } : {}),
  }).format(new Date(bucket.bucketStart));
}

export function formatStatus(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export function WindowSwitcher({
  value,
  onChange,
}: {
  value: PostingAnalyticsWindow;
  onChange: (window: PostingAnalyticsWindow) => void;
}) {
  const options: PostingAnalyticsWindow[] = ["7d", "30d", "all"];

  return (
    <div className="inline-flex rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
            value === option
              ? "bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 text-white"
              : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-950 dark:hover:text-white"
          }`}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function MetricSelect({
  value,
  onChange,
}: {
  value: BucketMetricKey;
  onChange: (value: BucketMetricKey) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as BucketMetricKey)}
      className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white outline-none transition focus:border-slate-400 dark:focus:border-slate-500"
    >
      {CHART_METRICS.map((metric) => (
        <option key={metric.key} value={metric.key}>
          {metric.label}
        </option>
      ))}
    </select>
  );
}

export function GranularitySelect({
  disabled,
  value,
  onChange,
}: {
  disabled?: boolean;
  value: "hour" | "day";
  onChange: (value: "hour" | "day") => void;
}) {
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value as "hour" | "day")}
      className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white outline-none transition focus:border-slate-400 dark:focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="day">Daily</option>
      <option value="hour">Hourly</option>
    </select>
  );
}

export function AnalyticsCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.8rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function FreshnessBadge({
  lastUpdatedAt,
  refreshing,
}: {
  lastUpdatedAt?: string;
  refreshing?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
      <span
        className={`h-2 w-2 rounded-full ${refreshing ? "bg-amber-500" : "bg-emerald-500"}`}
      />
      {refreshing
        ? "Refreshing..."
        : `Live · ${formatTimestamp(lastUpdatedAt)}`}
    </div>
  );
}

export function StatCard({
  eyebrow,
  value,
  detail,
  accent,
  sparklineValues,
  href,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  accent: string;
  sparklineValues?: number[];
  href?: string;
}) {
  const content = (
    <div className="group rounded-[1.6rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
      <div className={`h-1.5 w-16 rounded-full bg-gradient-to-r ${accent}`} />
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
        {value}
      </p>
      <p className="mt-2 min-h-10 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {detail}
      </p>
      <div className="mt-4">
        <MiniSparkline values={sparklineValues ?? []} accent={accent} />
      </div>
    </div>
  );

  if (!href) {
    return content;
  }

  return <Link href={href}>{content}</Link>;
}

export function MiniSparkline({
  values,
  accent,
}: {
  values: number[];
  accent: string;
}) {
  void accent;

  if (values.length === 0 || values.every((value) => value === 0)) {
    return <div className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800" />;
  }

  const points = buildChartPoints(values, 160, 40);

  return (
    <svg
      viewBox="0 0 160 40"
      className="h-10 w-full overflow-visible text-slate-900 dark:text-slate-100"
    >
      <path
        d={`M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrendChart({
  buckets,
  metricKey,
}: {
  buckets: PostingAnalyticsBucket[];
  metricKey: BucketMetricKey;
}) {
  const values = buckets.map((bucket) => bucket.metrics[metricKey] ?? 0);

  if (buckets.length === 0 || values.every((value) => value === 0)) {
    return (
      <div className="flex h-72 items-center justify-center rounded-[1.4rem] border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-sm text-slate-500 dark:text-slate-400">
        Trend data will appear here as this posting starts receiving activity.
      </div>
    );
  }

  const points = buildChartPoints(values, 860, 240);
  const areaPath = [
    `M ${points[0]!.x} 240`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${points[points.length - 1]!.x} 240`,
    "Z",
  ].join(" ");
  const linePath = `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;

  return (
    <div className="rounded-[1.4rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4">
      <svg
        viewBox="0 0 860 260"
        className="h-72 w-full text-slate-900 dark:text-slate-100"
      >
        <defs>
          <linearGradient id="trend-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#trend-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <circle
            key={`${point.x}-${point.y}`}
            cx={point.x}
            cy={point.y}
            r="4"
            className="fill-white stroke-current dark:fill-slate-900"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-4 lg:grid-cols-6">
        {buckets.slice(Math.max(0, buckets.length - 6)).map((bucket) => (
          <div
            key={bucket.bucketStart}
            className="rounded-xl bg-white dark:bg-slate-900 px-3 py-2"
          >
            <p className="font-medium text-slate-700 dark:text-slate-200">
              {formatBucketLabel(bucket)}
            </p>
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              {formatMetricValue(metricKey, bucket.metrics[metricKey])}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FunnelCard({
  metrics,
  derivedMetrics,
}: {
  metrics: PostingAnalyticsMetrics;
  derivedMetrics: PostingAnalyticsDerivedMetrics;
}) {
  const steps = [
    {
      label: "Impressions",
      value: metrics.searchImpressions,
      note: "Discovery in search results",
    },
    {
      label: "Search clicks",
      value: metrics.searchClicks,
      note: formatPercent(derivedMetrics.ctr) + " CTR",
    },
    {
      label: "Listing views",
      value: metrics.views,
      note: formatWholeNumber(metrics.uniqueViews) + " unique viewers",
    },
    {
      label: "Requests",
      value: metrics.bookingRequests,
      note:
        formatPercent(derivedMetrics.viewToRequestRate) + " view-to-request",
    },
    {
      label: "Approvals",
      value: metrics.approvedRequests,
      note:
        formatPercent(derivedMetrics.requestToApprovalRate) + " approval rate",
    },
    {
      label: "Confirmations",
      value: metrics.confirmedBookings,
      note:
        formatPercent(derivedMetrics.requestToConfirmedRate) +
        " request-to-confirmed",
    },
  ];
  const maxValue = Math.max(...steps.map((step) => step.value), 1);

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div
          key={step.label}
          className="rounded-[1.3rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {step.label}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {step.note}
              </p>
            </div>
            <p className="text-base font-semibold text-slate-950 dark:text-white">
              {formatWholeNumber(step.value)}
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white dark:bg-slate-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-slate-950 dark:from-slate-100 via-slate-700 dark:via-slate-400 to-slate-500 dark:to-slate-600"
              style={{
                width: `${Math.max(8, (step.value / maxValue) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OutcomeBars({ metrics }: { metrics: PostingAnalyticsMetrics }) {
  const rows = [
    {
      label: "Approved",
      value: metrics.approvedRequests,
      tone: "bg-emerald-500",
    },
    { label: "Declined", value: metrics.declinedRequests, tone: "bg-rose-500" },
    { label: "Expired", value: metrics.expiredRequests, tone: "bg-amber-500" },
    {
      label: "Cancelled",
      value: metrics.cancelledRequests,
      tone: "bg-slate-500",
    },
    {
      label: "Payment failed",
      value: metrics.paymentFailedRequests,
      tone: "bg-fuchsia-500",
    },
  ];
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {row.label}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {formatWholeNumber(row.value)}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${row.tone}`}
              style={{ width: `${(row.value / maxValue) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiagnosticsList({
  items,
}: {
  items: Array<{
    title: string;
    detail: string;
    tone: "amber" | "emerald" | "rose" | "slate";
  }>;
}) {
  const toneClasses = {
    amber:
      "border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200",
    emerald:
      "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200",
    rose: "border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200",
    slate:
      "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white",
  } as const;

  if (items.length === 0) {
    return (
      <div className="rounded-[1.3rem] border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
        More diagnostics will appear once this posting has enough search and
        booking activity to compare stages.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div
          key={item.title}
          className={`rounded-[1.3rem] border px-4 py-4 ${toneClasses[item.tone]}`}
        >
          <p className="font-semibold">{item.title}</p>
          <p className="mt-1 text-sm opacity-80">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

export function EmptyAnalyticsState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.7rem] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-10 text-center">
      <p className="text-lg font-semibold text-slate-950 dark:text-white">
        {title}
      </p>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.7rem] border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-6 py-8 text-rose-900 dark:text-rose-200">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-6 text-rose-800 dark:text-rose-300">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function RestrictedState() {
  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,_#020617,_#0b1120)] px-6 py-12 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-[0_28px_80px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          Dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
          Owner analytics unlock when you start hosting
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
          This workspace is reserved for owner accounts because it summarizes
          posting performance, booking conversion, and revenue trends.
        </p>
        <div className="mt-6">
          <Link
            href="/account"
            className="inline-flex items-center rounded-xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Back to account
          </Link>
        </div>
      </div>
    </main>
  );
}

export function LoadingDashboard() {
  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,_#020617,_#0b1120)] px-6 py-12 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="h-28 rounded-[2rem] bg-white dark:bg-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.06)]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-40 rounded-[1.6rem] bg-white dark:bg-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
            />
          ))}
        </div>
      </div>
    </main>
  );
}

export function buildDashboardDiagnostics(
  metrics: PostingAnalyticsMetrics,
): Array<{
  title: string;
  detail: string;
  tone: "amber" | "emerald" | "rose" | "slate";
}> {
  const diagnostics: Array<{
    title: string;
    detail: string;
    tone: "amber" | "emerald" | "rose" | "slate";
  }> = [];

  if (metrics.searchImpressions >= 25 && metrics.searchClicks === 0) {
    diagnostics.push({
      title: "High exposure, no search clicks yet",
      detail:
        "Your listings are appearing in search, but titles, thumbnails, or price positioning may not be compelling enough to earn the next click.",
      tone: "amber",
    });
  }

  if (metrics.views >= 10 && metrics.bookingRequests === 0) {
    diagnostics.push({
      title: "Views are not converting into requests",
      detail:
        "Shoppers are landing on the posting, but the value proposition may need stronger photos, clearer availability, or better pricing context.",
      tone: "rose",
    });
  }

  if (metrics.bookingRequests > 0 && metrics.confirmedBookings === 0) {
    diagnostics.push({
      title: "Requests are coming in, but none are confirming",
      detail:
        "The drop-off is happening after inquiry. Approval speed, payment friction, and calendar certainty are worth checking first.",
      tone: "amber",
    });
  }

  if (metrics.confirmedBookings > 0) {
    diagnostics.push({
      title: "The funnel is producing confirmed bookings",
      detail:
        "This posting is already converting. Use the live trend chart to spot what changed when performance improved.",
      tone: "emerald",
    });
  }

  return diagnostics.slice(0, 3);
}

export function formatMetricValue(
  metricKey: BucketMetricKey,
  value: number,
): string {
  const metric = CHART_METRICS.find((item) => item.key === metricKey);

  if (metric?.formatter === "money") {
    return formatMoney(value);
  }

  return formatCompactNumber(value);
}

function buildChartPoints(values: number[], width: number, height: number) {
  const safeValues = values.length > 0 ? values : [0];
  const maxValue = Math.max(...safeValues, 1);

  return safeValues.map((value, index) => ({
    x:
      safeValues.length === 1
        ? width / 2
        : (index / (safeValues.length - 1)) * width,
    y: height - (value / maxValue) * (height - 12) - 6,
  }));
}
