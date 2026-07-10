import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";

export const metadata: Metadata = {
  title: "Privacy | Rentify",
  description:
    "Read the Rentify privacy policy and how information is handled across the site.",
};

const privacySections = [
  {
    title: "Information we collect",
    body: "We may collect contact details, account details, usage information, device information, and messages you choose to send through the site or account-related flows.",
  },
  {
    title: "How information is used",
    body: "Information is used to operate the service, maintain security, support customer communication, improve product experiences, and meet legal or compliance obligations.",
  },
  {
    title: "Sharing and processors",
    body: "We may work with infrastructure, analytics, communication, and verification providers who process information on our behalf under appropriate contractual safeguards.",
  },
  {
    title: "Retention and rights",
    body: "We retain information for as long as necessary to provide the service, resolve disputes, enforce agreements, and meet regulatory requirements. Users may request access, correction, or deletion where applicable.",
  },
];

export default function PrivacyPage() {
  return (
    <MarketingPageShell
      eyebrow="Privacy policy"
      title="Our privacy policy is written to explain what Rentify collects and why."
      description="This page outlines how information is handled across account access, support flows, browsing activity, owner tools, and any messages you choose to send through the platform."
      accent="rgba(37,99,235,0.18)"
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700 dark:text-violet-300">
            Last updated
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
            May 13, 2026
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            Review and adapt this content with counsel before using it as your
            final published policy.
          </p>
        </div>
      }
      ctaLabel="Contact about privacy"
      ctaHref="/contact"
      secondaryCtaLabel="Read terms"
      secondaryCtaHref="/terms"
      quickLinks={[
        { href: "/accessibility", label: "Accessibility" },
        { href: "/faq", label: "FAQ" },
        { href: "/contact", label: "Contact" },
      ]}
      stats={[
        { label: "Policy sections", value: "4" },
        { label: "Applies to", value: "Site + accounts" },
        { label: "Updated", value: "2026" },
      ]}
    >
      <section className="grid gap-5">
        {privacySections.map((section) => (
          <article
            key={section.title}
            className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-7 shadow-sm"
          >
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {section.title}
            </h2>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              {section.body}
            </p>
          </article>
        ))}
      </section>
    </MarketingPageShell>
  );
}
