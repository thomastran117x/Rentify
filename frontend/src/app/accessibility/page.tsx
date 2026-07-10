import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { SectionHeading } from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "Accessibility | Rentify",
  description:
    "Read Rentify's accessibility commitments and learn how to request support or accommodations.",
};

const accessibilityAreas = [
  {
    title: "Readable content and structure",
    body: "We aim to keep headings, section order, and page copy understandable so people can navigate the site with less cognitive friction.",
  },
  {
    title: "Keyboard and device support",
    body: "Core navigation, links, and interactive controls should remain usable across common devices and keyboard-first workflows.",
  },
  {
    title: "Ongoing improvement",
    body: "Accessibility work is continuous. We expect to keep refining contrast, focus states, semantics, and interaction patterns as the product evolves.",
  },
  {
    title: "Help when you need it",
    body: "If you encounter a barrier, contact the team so we can provide an alternate path or work toward a fix where reasonable.",
  },
];

export default function AccessibilityPage() {
  return (
    <MarketingPageShell
      eyebrow="Accessibility"
      title="Rentify should be usable by more people, on more devices, with fewer barriers."
      description="This page explains the accessibility direction for the site and where to go if you need support, accommodations, or a different way to access key information."
      accent="rgba(66,109,86,0.2)"
      ctaLabel="Contact for accessibility help"
      ctaHref="/contact"
      secondaryCtaLabel="Read the FAQ"
      secondaryCtaHref="/faq"
      quickLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
        { href: "/about", label: "About" },
      ]}
      stats={[
        { label: "Focus areas", value: "4" },
        { label: "Support channel", value: "Contact page" },
        { label: "Status", value: "Ongoing work" },
      ]}
      aside={
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-violet-700 dark:text-violet-300">
            Need an accommodation
          </p>
          <p className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            We want to help.
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            If a feature, page, or workflow is difficult to use, tell us what is
            getting in the way and what format would work better for you.
          </p>
        </div>
      }
    >
      <section>
        <SectionHeading
          eyebrow="Accessibility commitment"
          title="The goal is steady, practical improvement across the whole experience."
          description="Accessibility is part of product quality. We treat it as something to keep improving as we build out the marketplace, not something to bolt on at the end."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {accessibilityAreas.map((area) => (
            <article
              key={area.title}
              className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-7 shadow-sm"
            >
              <h2 className="text-3xl leading-tight font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {area.title}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
                {area.body}
              </p>
            </article>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
}
