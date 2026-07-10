import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { ContactInquiryForm } from "@/components/marketing/contact-inquiry-form";

export const metadata: Metadata = {
  title: "Contact & Feedback | Rentify",
  description:
    "Contact Rentify for support and share product feedback about the app experience.",
};

const contactChannels = [
  { label: "General support", value: "hello@rentify.co" },
  { label: "Trust and safety", value: "safety@rentify.co" },
  { label: "Support hours", value: "Mon - Fri, 9:00 AM - 6:00 PM" },
];

export default function ContactPage() {
  return (
    <MarketingPageShell
      eyebrow="Contact and feedback"
      title="Reach out for support, and tell us how the Rentify app can improve."
      description="Use this page for renter support, owner onboarding questions, partnerships, policy help, or product feedback about what is working and what needs attention."
      accent="rgba(66,109,86,0.24)"
      ctaLabel="Browse rentals"
      ctaHref="/postings"
      secondaryCtaLabel="Read the FAQ"
      secondaryCtaHref="/faq"
      quickLinks={[
        { href: "/how-it-works", label: "How it works" },
        { href: "/accessibility", label: "Accessibility" },
        { href: "/privacy", label: "Privacy" },
      ]}
      stats={[
        { label: "Response target", value: "1 business day" },
        { label: "Feedback modes", value: "5" },
        { label: "Coverage", value: "Support + product" },
      ]}
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700 dark:text-violet-300">
            Product signal
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
            Bugs, ideas, and friction
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            Share the workflow, page, or moment that needs attention so the team
            can prioritize the next improvements with better context.
          </p>
        </div>
      }
    >
      <section className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
        <div className="grid gap-5">
          {contactChannels.map((channel) => (
            <article
              key={channel.label}
              className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                {channel.label}
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {channel.value}
              </p>
            </article>
          ))}
        </div>

        <ContactInquiryForm />
      </section>
    </MarketingPageShell>
  );
}
