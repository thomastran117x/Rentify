import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { SectionHeading } from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "FAQ | Rentify",
  description:
    "Find answers to common Rentify questions about searching, listings, policies, and support.",
};

const faqs = [
  {
    question: "What kinds of rentals can I find on Rentify?",
    answer:
      "Rentify supports multiple rental categories, including homes, spaces, equipment, studios, storage, and other listing types made available by owners on the marketplace.",
  },
  {
    question: "How do I know whether a listing is available?",
    answer:
      "Availability depends on the information provided by the owner and the current booking flow for that category. Review the listing details carefully and confirm any edge cases before final commitment.",
  },
  {
    question: "Can owners manage multiple listings?",
    answer:
      "Yes. Rentify is designed to support both individual hosts and operators managing a broader portfolio, with listing and dashboard flows built to scale with that workload.",
  },
  {
    question: "Where can I ask for help if something is unclear?",
    answer:
      "Start with the contact page for renter support, owner questions, accessibility requests, or trust and safety concerns. The team can route the request from there.",
  },
  {
    question: "Do privacy and legal policies apply to all users?",
    answer:
      "Yes. The privacy and terms pages describe the baseline expectations for using the site, handling account information, and understanding platform limitations.",
  },
  {
    question: "What should I do if I need an accommodation to use the site?",
    answer:
      "Visit the accessibility page or contact support directly so the team can help with alternate communication or other reasonable accommodations.",
  },
];

export default function FaqPage() {
  return (
    <MarketingPageShell
      eyebrow="FAQ"
      title="Common questions, answered without the runaround."
      description="This page is here for the practical things people usually need before they feel ready to browse, list, or trust a marketplace with their next booking."
      accent="rgba(66,109,86,0.22)"
      ctaLabel="Browse rentals"
      ctaHref="/postings"
      secondaryCtaLabel="Contact support"
      secondaryCtaHref="/contact"
      quickLinks={[
        { href: "/how-it-works", label: "How it works" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      stats={[
        { label: "Questions covered", value: "6" },
        { label: "Topics", value: "Search to support" },
        { label: "Format", value: "Plain language" },
      ]}
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700 dark:text-violet-300">
            Best place to start
          </p>
          <p className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Quick answers first.
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            If the answer you need is not here, the contact page is the next
            fastest route to a human response.
          </p>
        </div>
      }
    >
      <section>
        <SectionHeading
          eyebrow="Questions people ask most"
          title="Start here when you need the basics before the booking flow."
          description="We keep the FAQ direct, readable, and focused on the questions that help renters and owners orient themselves quickly."
        />
        <div className="mt-10 grid gap-4">
          {faqs.map((item, index) => (
            <article
              key={item.question}
              className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                FAQ 0{index + 1}
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                {item.question}
              </h2>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                {item.answer}
              </p>
            </article>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
}
