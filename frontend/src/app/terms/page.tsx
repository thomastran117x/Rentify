import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";

export const metadata: Metadata = {
  title: "Terms | Rentify",
  description:
    "Review the Rentify terms for site access, marketplace usage, account responsibilities, and limitations.",
};

const termsSections = [
  {
    title: "Using the marketplace",
    body: "By accessing Rentify, you agree to use the marketplace lawfully, provide accurate information when needed, and avoid interfering with the security, performance, or availability of the service.",
  },
  {
    title: "Accounts and responsibilities",
    body: "If you create an account, you are responsible for maintaining your credentials and for the activity that occurs under that account, subject to applicable consumer protections and local law.",
  },
  {
    title: "Listings, availability, and pricing",
    body: "Listings may change over time. Availability, pricing, delivery details, and owner-specific requirements should be confirmed through the applicable booking or support flow before final commitment.",
  },
  {
    title: "Limitations and additional terms",
    body: "Rentify may update or suspend parts of the marketplace from time to time. Specific listings, payment flows, local rules, or booking agreements may carry additional terms depending on the category and jurisdiction involved.",
  },
];

export default function TermsPage() {
  return (
    <MarketingPageShell
      eyebrow="Terms"
      title="These terms set expectations for using Rentify and interacting with listings on the marketplace."
      description="Use this page to understand the baseline rules around access, accounts, listing information, and the limits of the platform before booking or publishing a rental."
      accent="rgba(212,168,95,0.22)"
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700">
            Guidance
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950">
            Template content
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Review this language with legal counsel before publishing,
            especially if your marketplace processes payments, recurring
            rentals, or regional consumer rights.
          </p>
        </div>
      }
      ctaLabel="Contact support"
      ctaHref="/contact"
      secondaryCtaLabel="Read privacy"
      secondaryCtaHref="/privacy"
      quickLinks={[
        { href: "/faq", label: "FAQ" },
        { href: "/accessibility", label: "Accessibility" },
        { href: "/how-it-works", label: "How it works" },
      ]}
      stats={[
        { label: "Legal sections", value: "4" },
        { label: "Applies to", value: "All users" },
        { label: "Updated", value: "May 2026" },
      ]}
    >
      <section className="grid gap-5">
        {termsSections.map((section) => (
          <article
            key={section.title}
            className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm"
          >
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
              {section.title}
            </h2>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-600">
              {section.body}
            </p>
          </article>
        ))}
      </section>
    </MarketingPageShell>
  );
}
