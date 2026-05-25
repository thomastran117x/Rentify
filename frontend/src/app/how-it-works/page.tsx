import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { SectionHeading } from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "How It Works | Rentify",
  description:
    "See how renters discover listings on Rentify and how owners can publish and manage rentals on the platform.",
};

const renterSteps = [
  {
    title: "Search by need, place, or category",
    description:
      "Start with the intent you already have, then narrow by location, rental type, and the listing signals that matter most.",
  },
  {
    title: "Compare listings with less guesswork",
    description:
      "Review pricing, photos, availability, and owner-provided details in a format designed to reduce back-and-forth.",
  },
  {
    title: "Reach out or move toward booking",
    description:
      "Once a listing fits, use the next step that makes sense for the category, whether that is an inquiry, request, or confirmed booking flow.",
  },
];

const ownerSteps = [
  {
    title: "Create a clearer listing",
    description:
      "Publish photos, descriptions, policies, pricing, and availability so renters have what they need upfront.",
  },
  {
    title: "Keep information current",
    description:
      "Maintain listing accuracy over time so fewer inquiries turn into avoidable clarification loops.",
  },
  {
    title: "Manage interest with more confidence",
    description:
      "Use your dashboard and support touchpoints to stay on top of activity as bookings and questions come in.",
  },
];

export default function HowItWorksPage() {
  return (
    <MarketingPageShell
      eyebrow="How it works"
      title="Rentify is built to help renters discover faster and owners present listings more clearly."
      description="The product flow is simple by design: better search, clearer listing information, and practical support pages around the edges so fewer decisions happen in the dark."
      accent="rgba(37,99,235,0.18)"
      ctaLabel="Browse rentals"
      ctaHref="/postings"
      secondaryCtaLabel="Read the FAQ"
      secondaryCtaHref="/faq"
      quickLinks={[
        { href: "/services", label: "Services" },
        { href: "/contact", label: "Contact" },
        { href: "/about", label: "About" },
      ]}
      stats={[
        { label: "Renter steps", value: "3" },
        { label: "Owner steps", value: "3" },
        { label: "Goal", value: "Less friction" },
      ]}
      aside={
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700">
              Marketplace flow
            </p>
            <p className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
              Search, compare, act.
            </p>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              We keep the path from discovery to decision tight so users are not
              buried in avoidable complexity.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              Good next steps
            </p>
            <div className="mt-3 grid gap-2">
              <Link
                href="/postings"
                className="text-sm font-medium text-violet-700 hover:text-violet-800"
              >
                Browse current rentals
              </Link>
              <Link
                href="/contact"
                className="text-sm font-medium text-violet-700 hover:text-violet-800"
              >
                Ask a support question
              </Link>
            </div>
          </div>
        </div>
      }
    >
      <section>
        <SectionHeading
          eyebrow="For renters"
          title="A calmer path from search to shortlist."
          description="Rentify helps people find the right fit by bringing the most decision-critical details closer to the start of the journey."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {renterSteps.map((step, index) => (
            <article
              key={step.title}
              className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Step 0{index + 1}
              </p>
              <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-[-0.04em] text-slate-950">
                {step.title}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                {step.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <SectionHeading
          eyebrow="For owners"
          title="A better storefront for the things you rent out."
          description="Owners need the same thing renters do: clarity. Rentify supports a cleaner listing and communication workflow so more inquiries start from a stronger baseline."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {ownerSteps.map((step, index) => (
            <article
              key={step.title}
              className="rounded-[2rem] border border-slate-200 bg-slate-50 px-6 py-7 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Owner 0{index + 1}
              </p>
              <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-[-0.04em] text-slate-950">
                {step.title}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                {step.description}
              </p>
            </article>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
}
