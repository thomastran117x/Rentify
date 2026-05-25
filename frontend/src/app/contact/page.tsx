import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { ContactInquiryForm } from "@/components/marketing/contact-inquiry-form";

export const metadata: Metadata = {
  title: "Contact | Rentify",
  description:
    "Contact Rentify for renter support, owner questions, partnerships, or trust and safety issues.",
};

const contactChannels = [
  { label: "General support", value: "hello@rentify.co" },
  { label: "Trust and safety", value: "safety@rentify.co" },
  { label: "Support hours", value: "Mon - Fri, 9:00 AM - 6:00 PM" },
];

export default function ContactPage() {
  return (
    <MarketingPageShell
      eyebrow="Contact"
      title="Reach out when you need help finding, listing, or managing a rental."
      description="Use this page for renter support, owner onboarding questions, partnership requests, or policy and accessibility help."
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
        { label: "Support tracks", value: "4" },
        { label: "Coverage", value: "Renter + owner" },
      ]}
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700">
            Response window
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950">
            1 business day
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Best for booking questions, owner setup, partnerships, and any issue
            where you need a real answer from the team.
          </p>
        </div>
      }
    >
      <section className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
        <div className="grid gap-5">
          {contactChannels.map((channel) => (
            <article
              key={channel.label}
              className="rounded-[2rem] border border-slate-200 bg-white px-6 py-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                {channel.label}
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
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
