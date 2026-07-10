"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
} from "lucide-react";
import { PostingAutocompleteInput } from "@/components/postings/posting-autocomplete-input";

const stats = [
  { label: "Active postings", value: "4.2k+" },
  { label: "Cities supported", value: "58" },
  { label: "Avg. response time", value: "< 7 min" },
];

const categories = [
  "Apartments",
  "Equipment",
  "Studios",
  "Event spaces",
  "Vehicles",
  "Storage",
];

const featuredPostings = [
  {
    title: "Downtown studio workspace",
    location: "Toronto, ON",
    price: "$48/day",
    tag: "Workspace",
    rating: "4.9",
  },
  {
    title: "Camera kit with lighting",
    location: "Ottawa, ON",
    price: "$35/day",
    tag: "Equipment",
    rating: "4.8",
  },
  {
    title: "Modern event loft",
    location: "Mississauga, ON",
    price: "$120/hr",
    tag: "Venue",
    rating: "5.0",
  },
];

const sitePages = [
  {
    title: "How it works",
    description: "See the renter and owner journey in one clean overview.",
    href: "/how-it-works",
  },
  {
    title: "Services",
    description:
      "Explore the product capabilities that support search, listings, and trust.",
    href: "/services",
  },
  {
    title: "About",
    description:
      "Learn what Rentify is trying to improve about rental discovery.",
    href: "/about",
  },
  {
    title: "FAQ",
    description: "Get practical answers to common marketplace questions.",
    href: "/faq",
  },
  {
    title: "Contact",
    description:
      "Reach support for renter questions, owner setup, or partnerships.",
    href: "/contact",
  },
  {
    title: "Accessibility",
    description:
      "Read our accessibility commitment and request support when needed.",
    href: "/accessibility",
  },
  {
    title: "Privacy",
    description:
      "Understand how data is handled across the site and account flows.",
    href: "/privacy",
  },
  {
    title: "Terms",
    description:
      "Review the marketplace rules, responsibilities, and limitations.",
    href: "/terms",
  },
];

const benefits = [
  {
    title: "Search with less friction",
    description:
      "Find rentals by keyword, location, category, or intent without digging through cluttered listings.",
    icon: Search,
  },
  {
    title: "Compare listings clearly",
    description:
      "Review pricing, availability, location, and listing details in a cleaner, more consistent flow.",
    icon: SlidersHorizontal,
  },
  {
    title: "Book with more confidence",
    description:
      "Trust signals, owner details, and clearer posting information help reduce uncertainty before booking.",
    icon: ShieldCheck,
  },
];

const ownerSteps = [
  "Create a posting with photos, pricing, and availability.",
  "Receive interested renters through a cleaner inquiry flow.",
  "Manage listings and booking activity from your account.",
];

function SearchIcon() {
  return <Search className="h-4 w-4" aria-hidden="true" />;
}

export default function Home() {
  const router = useRouter();
  const [locationQuery, setLocationQuery] = useState("");

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const searchQuery = String(formData.get("q") ?? "").trim();

    if (searchQuery) {
      params.set("q", searchQuery);
    }

    if (locationQuery.trim()) {
      params.set("location", locationQuery.trim());
    }

    const queryString = params.toString();

    router.push(queryString ? `/postings?${queryString}` : "/postings");
  }

  return (
    <main className="min-h-screen bg-white dark:bg-slate-900 text-slate-950 dark:text-white">
      <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(124,58,237,0.12),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(99,102,241,0.10),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_20%_15%,rgba(124,58,237,0.18),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.14),transparent_26%),linear-gradient(180deg,#020617_0%,#0b1120_100%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8 lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Rental search made simpler
            </div>

            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.055em] text-slate-950 dark:text-white sm:text-6xl lg:text-7xl">
              Find the right rental without the clutter.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300 sm:text-lg">
              Search homes, spaces, equipment, and services from one clean
              marketplace built around faster discovery and clearer posting
              details.
            </p>

            <form
              onSubmit={handleSearch}
              className="mt-8 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xl shadow-slate-950/5"
            >
              <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr_auto]">
                <PostingAutocompleteInput
                  label="Search rentals"
                  placeholder="What are you looking for?"
                  shellClassName="group flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 transition duration-200 focus-within:border-violet-500 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-violet-500/10"
                  icon={<SearchIcon />}
                  iconClassName="text-slate-400 dark:text-slate-500 transition group-focus-within:text-violet-600"
                  inputClassName="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />

                <label className="group flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 transition duration-200 focus-within:border-violet-500 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-violet-500/10">
                  <MapPin className="h-4 w-4 text-slate-400 dark:text-slate-500 transition group-focus-within:text-violet-600" />
                  <span className="sr-only">Location</span>
                  <input
                    value={locationQuery}
                    onChange={(event) => setLocationQuery(event.target.value)}
                    placeholder="Location"
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </label>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 active:translate-y-0"
                >
                  Search
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Popular:
              </span>

              {categories.slice(0, 4).map((category) => (
                <Link
                  key={category}
                  href={`/postings?category=${encodeURIComponent(category)}`}
                  className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 dark:hover:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-700 dark:hover:text-violet-300"
                >
                  {category}
                </Link>
              ))}
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {stats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm"
                >
                  <p className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                    {item.value}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-8 -top-8 h-32 w-32 rounded-full bg-violet-200/50 blur-3xl" />
            <div className="absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-indigo-200/50 blur-3xl" />

            <div className="relative rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xl shadow-slate-950/10">
              <div className="rounded-[1.5rem] bg-slate-950 p-5 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
                      Featured rental
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                      Modern loft space
                    </h2>
                  </div>

                  <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15">
                    Available
                  </div>
                </div>

                <div className="mt-6 aspect-[4/3] rounded-3xl bg-[radial-gradient(circle_at_30%_20%,rgba(167,139,250,0.8),transparent_30%),linear-gradient(135deg,#312e81,#111827_55%,#020617)]" />

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                    <p className="text-xs text-slate-300">Price</p>
                    <p className="mt-1 font-semibold">$120/hr</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                    <p className="text-xs text-slate-300">Rating</p>
                    <p className="mt-1 font-semibold">5.0</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                    <p className="text-xs text-slate-300">Area</p>
                    <p className="mt-1 font-semibold">1.2k sq ft</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
                  <CalendarDays className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  <p className="mt-3 text-sm font-semibold text-slate-950 dark:text-white">
                    Flexible availability
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Compare dates and rental windows before reaching out.
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
                  <ShieldCheck className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  <p className="mt-3 text-sm font-semibold text-slate-950 dark:text-white">
                    Clear listing details
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Review rules, pricing, and owner details in one place.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
              Browse by category
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl">
              Start with what you need.
            </h2>
          </div>

          <Link
            href="/postings"
            className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300 transition hover:text-violet-800 dark:hover:text-violet-200"
          >
            Browse all postings
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category}
              href={`/postings?category=${encodeURIComponent(category)}`}
              className="group rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-xl hover:shadow-slate-950/5"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                    {category}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Explore available rentals
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 transition duration-200 group-hover:translate-x-1 group-hover:bg-violet-600 group-hover:text-white">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
              Why Rentify
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl">
              A cleaner way to discover and manage rentals.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">
              Rentify keeps search, comparison, and listing management focused
              so renters and owners can move faster.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;

              return (
                <article
                  key={benefit.title}
                  className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
                    <Icon className="h-5 w-5" />
                  </div>

                  <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                    {benefit.title}
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {benefit.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
              Featured postings
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl">
              Recently added rentals.
            </h2>
          </div>

          <Link
            href="/postings"
            className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300 transition hover:text-violet-800 dark:hover:text-violet-200"
          >
            View more
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {featuredPostings.map((posting) => (
            <article
              key={posting.title}
              className="group overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-950/5"
            >
              <div className="aspect-[4/3] bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.16),transparent_30%),linear-gradient(135deg,#f8fafc,#ede9fe_55%,#ffffff)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.28),transparent_30%),linear-gradient(135deg,#0f172a,#1e1b4b_55%,#020617)]" />

              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-violet-50 dark:bg-violet-950/40 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {posting.tag}
                  </span>

                  <span className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-300">
                    <Star className="h-4 w-4 fill-violet-600 text-violet-600 dark:text-violet-400" />
                    {posting.rating}
                  </span>
                </div>

                <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                  {posting.title}
                </h3>

                <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <MapPin className="h-4 w-4" />
                  {posting.location}
                </p>

                <div className="mt-5 flex items-center justify-between">
                  <p className="text-lg font-semibold text-slate-950 dark:text-white">
                    {posting.price}
                  </p>

                  <Link
                    href="/postings"
                    className="text-sm font-semibold text-violet-700 dark:text-violet-300 transition hover:text-violet-800 dark:hover:text-violet-200"
                  >
                    View details
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
              Core pages
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl">
              The rest of the site now carries the same design system.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
              From about and contact to legal and accessibility pages, the core
              marketing surface is now part of the same polished web experience.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {sitePages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="group rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-xl hover:shadow-slate-950/5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                      {page.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {page.description}
                    </p>
                  </div>

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 transition duration-200 group-hover:translate-x-1 group-hover:bg-violet-600 group-hover:text-white">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-slate-950 p-6 text-white shadow-2xl shadow-slate-950/10 sm:p-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-violet-300">For owners</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Have something to rent out?
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Create a clean posting, show renters the important details, and
              manage interest from one account.
            </p>

            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-50"
            >
              List a rental
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="rounded-3xl bg-white/10 p-5 ring-1 ring-white/10">
            <div className="grid gap-4">
              {ownerSteps.map((step) => (
                <div key={step} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                  <p className="text-sm leading-6 text-slate-200">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
