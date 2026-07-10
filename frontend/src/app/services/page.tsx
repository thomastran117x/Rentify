import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";

export const metadata: Metadata = {
  title: "Services | Rentify",
  description:
    "Explore the services Rentify provides for renters, owners, and teams managing listings at scale.",
};

const serviceGroups = [
  {
    name: "Rental search and discovery",
    description:
      "Search across categories, locations, and intent so renters can move from browsing to shortlist faster.",
  },
  {
    name: "Clear listing presentation",
    description:
      "Pricing, availability, photos, and listing details are structured to answer the practical questions before someone reaches out.",
  },
  {
    name: "Owner workflow support",
    description:
      "Owners can maintain a cleaner storefront, keep their inventory current, and manage incoming interest from one place.",
  },
  {
    name: "Trust, policy, and support layers",
    description:
      "Core pages like FAQ, privacy, terms, accessibility, and contact are part of the product experience, not an afterthought.",
  },
];

export default function ServicesPage() {
  return (
    <MarketingPageShell
      eyebrow="Services"
      title="Marketplace services that support discovery, trust, and day-to-day rental operations."
      description="Rentify is designed to help renters find the right fit faster while giving owners and operators a cleaner digital experience across search, listing presentation, and support content."
      accent="rgba(37,99,235,0.18)"
      ctaLabel="Browse rentals"
      ctaHref="/postings"
      secondaryCtaLabel="Contact our team"
      secondaryCtaHref="/contact"
      quickLinks={[
        { href: "/how-it-works", label: "How it works" },
        { href: "/faq", label: "FAQ" },
        { href: "/privacy", label: "Privacy" },
      ]}
      stats={[
        { label: "Core service areas", value: "4" },
        { label: "Audience types", value: "Renters + owners" },
        { label: "Support coverage", value: "End to end" },
      ]}
      aside={
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700 dark:text-violet-300">
              Typical scope
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Search, discovery, listing detail experiences, owner tooling, and
              the supporting static pages that help users trust the marketplace.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
              Best for
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-900 dark:text-white">
              Renters comparing options, hosts presenting listings, and
              operations teams who need a clearer marketplace front door.
            </p>
          </div>
        </div>
      }
    >
      <section className="grid gap-5 lg:grid-cols-2">
        {serviceGroups.map((group, index) => (
          <article
            key={group.name}
            className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-7 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
              Service 0{index + 1}
            </p>
            <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {group.name}
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {group.description}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-14 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-7 py-9 shadow-sm sm:px-9">
        <div className="grid gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-700 dark:text-violet-300">
              Need a hand
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
              We can help you figure out the right path on the marketplace.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              If you are trying to find a rental, list an asset, or understand
              how a policy affects your booking flow, the contact page is the
              next stop.
            </p>
          </div>
          <Link
            href="/contact"
            className="inline-flex h-14 items-center justify-center rounded-2xl bg-violet-600 px-6 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25"
          >
            Contact support
          </Link>
        </div>
      </section>
    </MarketingPageShell>
  );
}
