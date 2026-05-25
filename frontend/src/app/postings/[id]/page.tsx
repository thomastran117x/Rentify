import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  MapPin,
  Package,
  ScrollText,
  Tags,
} from "lucide-react";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import { PostingDetailGallery } from "@/components/postings/posting-detail-gallery";
import {
  getPublicPostingDetail,
  isPublicPostingDetailNotFoundError,
  type PublicPostingDetail,
} from "@/lib/postings/public";
import {
  formatPostingAttributeLabel,
  formatPostingAttributeValue,
  formatPostingPrice,
  formatPublishedDate,
  humanizePostingValue,
} from "@/lib/postings/public-format";
import { theme } from "@/styles/theme";

interface PostingDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: PostingDetailPageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const posting = await getPublicPostingDetail(id);

    return {
      title: `${posting.name} | Rentify`,
      description: posting.description.slice(0, 160),
    };
  } catch (error) {
    if (isPublicPostingDetailNotFoundError(error)) {
      return {
        title: "Posting Not Found | Rentify",
        description: "This posting is no longer available on Rentify.",
      };
    }

    return {
      title: "Posting Detail | Rentify",
      description:
        "Review pricing, availability, and listing details on Rentify.",
    };
  }
}

export default async function PostingDetailPage({
  params,
}: PostingDetailPageProps) {
  const { id } = await params;
  let posting: PublicPostingDetail;

  try {
    posting = await getPublicPostingDetail(id);
  } catch (error) {
    if (isPublicPostingDetailNotFoundError(error)) {
      notFound();
    }

    return <PostingDetailError />;
  }

  return <PostingDetailView posting={posting} />;
}

function PostingDetailView({ posting }: { posting: PublicPostingDetail }) {
  const publishedDate = formatPublishedDate(posting.publishedAt);
  const detailEntries = Object.entries(posting.details);
  const locationLine = [
    posting.location.city,
    posting.location.region,
    posting.location.country,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <div className="mb-5">
          <Link
            href="/postings"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition duration-200 hover:text-violet-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to postings
          </Link>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
            <div className="border-b border-slate-200 p-5 sm:p-6 lg:border-b-0 lg:border-r lg:p-7">
              <PostingDetailGallery
                photos={posting.photos}
                name={posting.name}
              />
            </div>

            <div className="bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_26%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 sm:p-7">
              <div className="flex flex-wrap gap-2">
                <span className={theme.marketplace.metaBadge}>
                  {humanizePostingValue(posting.variant.family)}
                </span>
                <span className={theme.marketplace.metaBadge}>
                  {humanizePostingValue(posting.variant.subtype)}
                </span>
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.055em] text-slate-950 sm:text-[2.8rem]">
                {posting.name}
              </h1>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <AvailabilityBadge status={posting.availabilityStatus} />
                <span className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {formatPostingPrice(
                    posting.pricing.daily.amount,
                    posting.pricing.currency,
                  )}
                </span>
                <span className="text-sm text-slate-500">per day</span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <SummaryCard
                  icon={
                    <MapPin
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Location"
                  value={locationLine}
                />
                <SummaryCard
                  icon={
                    <CalendarClock
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Published"
                  value={publishedDate ?? "Recently added"}
                />
                <SummaryCard
                  icon={
                    <Clock3
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Booking window"
                  value={`${posting.effectiveMaxBookingDurationDays} day max`}
                />
                <SummaryCard
                  icon={
                    <Package
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Listing type"
                  value={humanizePostingValue(posting.variant.subtype)}
                />
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Overview
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {posting.description}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_24rem]">
          <div className="space-y-6">
            <Panel
              icon={
                <ScrollText
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="About this posting"
              description="The essentials a renter would want to review before reaching out."
            >
              <p className="text-sm leading-8 text-slate-600">
                {posting.description}
              </p>
            </Panel>

            <Panel
              icon={
                <Package
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="Details"
              description="Variant-specific details for this listing."
            >
              {detailEntries.length > 0 ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {detailEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-3"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {formatPostingAttributeLabel(key)}
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-700">
                        {formatPostingAttributeValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-slate-500">
                  No additional details were provided.
                </p>
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel
              icon={
                <MapPin
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="Location"
              description="Where this posting is based."
            >
              <div className="space-y-3 text-sm text-slate-600">
                <p>{locationLine}</p>
                {posting.location.postalCode ? (
                  <p>Postal code: {posting.location.postalCode}</p>
                ) : null}
              </div>
            </Panel>

            <Panel
              icon={
                <CalendarClock
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="Availability"
              description="Current booking posture for this posting."
            >
              <div className="space-y-4 text-sm text-slate-600">
                <div className="flex flex-wrap items-center gap-3">
                  <AvailabilityBadge status={posting.availabilityStatus} />
                  <span>
                    {posting.effectiveMaxBookingDurationDays} day maximum
                    booking
                  </span>
                </div>
                {posting.availabilityNotes ? (
                  <p className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-3">
                    {posting.availabilityNotes}
                  </p>
                ) : (
                  <p>No extra availability notes were added.</p>
                )}
              </div>
            </Panel>

            <Panel
              icon={
                <Tags className="h-4 w-4 text-violet-600" aria-hidden="true" />
              }
              title="Tags"
              description="Helpful keywords associated with the posting."
            >
              {posting.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {posting.tags.map((tag) => (
                    <span key={tag} className={theme.marketplace.summaryPill}>
                      {formatPostingAttributeValue(tag)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No tags were added to this posting.
                </p>
              )}
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function PostingDetailError() {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <section className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-950/5 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
            Posting detail
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-4xl">
            We couldn&apos;t load this posting right now.
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            The listing details are temporarily unavailable. Please try again in
            a moment or head back to browse other postings.
          </p>
          <div className="mt-7">
            <Link href="/postings" className={theme.marketplace.primaryButton}>
              Back to postings
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}

function Panel({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50">
          {icon}
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}
