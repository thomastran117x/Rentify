import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PostingDetailClient } from "@/components/postings/posting-detail-client";
import {
  getPublicPostingDetail,
  isPublicPostingDetailNotFoundError,
} from "@/lib/postings/public";
import { theme } from "@/styles/theme";

interface PostingDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: PostingDetailPageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const posting = await getPublicPostingDetail(id);

    return {
      title: `${posting.name} | Rentify`,
      description: posting.description.slice(0, 160),
    };
  } catch (error) {
    if (isPublicPostingDetailNotFoundError(error)) {
      return {
        title: "Posting Not Found | Rentify",
        description: "This posting is no longer available on Rentify.",
      };
    }

    return {
      title: "Posting Detail | Rentify",
      description:
        "Review pricing, availability, and listing details on Rentify.",
    };
  }
}

export default async function PostingDetailPage({
  params,
}: PostingDetailPageProps) {
  const { id } = await params;
  let posting;

  try {
    posting = await getPublicPostingDetail(id);
  } catch (error) {
    if (isPublicPostingDetailNotFoundError(error)) {
      notFound();
    }

    return <PostingDetailError />;
  }

  return <PostingDetailClient posting={posting} />;
}

function PostingDetailError() {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <section className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-950/5 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
            Posting detail
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-4xl">
            We couldn&apos;t load this posting right now.
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            The listing details are temporarily unavailable. Please try again in
            a moment or head back to browse other postings.
          </p>
          <div className="mt-7">
            <Link href="/postings" className={theme.marketplace.primaryButton}>
              Back to postings
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
