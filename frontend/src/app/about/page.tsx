import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { SectionHeading } from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "About | Rentify",
  description:
    "Learn how Rentify helps renters discover listings faster and gives owners a cleaner way to present them.",
};

const values = [
  {
    title: "Discovery should feel simple",
    description:
      "Search, comparison, and listing details should help people narrow down quickly instead of forcing them through clutter.",
  },
  {
    title: "Trust belongs in the interface",
    description:
      "Availability, policies, pricing, and owner context should be visible where decisions are being made, not hidden after the fact.",
  },
  {
    title: "Owners need calm tools too",
    description:
      "A rental marketplace works better when hosts can keep listings accurate, communicate clearly, and manage changes without friction.",
  },
];

const process = [
  "Make browsing useful from the first query by keeping search, categories, and filters straightforward.",
  "Show clearer listing information so guests understand the fit, timing, and rules before they inquire.",
  "Support owners with a product experience that keeps their content, availability, and communication aligned.",
];

export default function AboutPage() {
  return (
    <MarketingPageShell
      eyebrow="About Rentify"
      title="We built Rentify to make rental discovery feel clearer from the first click."
      description="Rentify is a marketplace for spaces, equipment, homes, and other bookable rentals. Our focus is simple: reduce browsing noise, surface the details that matter, and give owners better ways to present what they offer."
      accent="rgba(212,168,95,0.24)"
      ctaLabel="Browse listings"
      ctaHref="/postings"
      secondaryCtaLabel="See how it works"
      secondaryCtaHref="/how-it-works"
      quickLinks={[
        { href: "/services", label: "Marketplace services" },
        { href: "/faq", label: "Frequently asked questions" },
        { href: "/contact", label: "Contact support" },
      ]}
      stats={[
        { label: "Rental categories", value: "6+" },
        { label: "Support windows", value: "7 days" },
        { label: "Listing clarity focus", value: "High" },
      ]}
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700 dark:text-violet-300">
            Our focus
          </p>
          <p className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Search confidence, trustworthy listings, and better owner tools.
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            Rentify keeps the marketplace experience grounded in useful
            structure so renters can move faster and owners can keep information
            accurate.
          </p>
        </div>
      }
    >
      <section>
        <SectionHeading
          eyebrow="What drives us"
          title="A better rental marketplace should help both sides move with less uncertainty."
          description="That means clearer presentation for owners and fewer decision-making gaps for the people trying to rent from them."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {values.map((value) => (
            <article
              key={value.title}
              className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-7 shadow-sm"
            >
              <h2 className="text-3xl leading-tight font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {value.title}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
                {value.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-7 py-8 shadow-sm lg:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-700 dark:text-violet-300">
            How we work
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
            Useful structure before feature noise.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            The marketplace gets stronger when search, listing content, and
            support flows answer the obvious questions early and clearly.
          </p>
        </div>
        <div className="grid gap-4">
          {process.map((item, index) => (
            <div
              key={item}
              className="rounded-[1.75rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                Step 0{index + 1}
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-900 dark:text-white">
                {item}
              </p>
            </div>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
}
