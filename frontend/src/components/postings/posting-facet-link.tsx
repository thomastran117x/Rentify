import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import {
  LOCATION_LEVELS,
  type FacetLocation,
  type LocationLevel,
} from "@/lib/postings/facet-href";
import { theme } from "@/styles/theme";

// Intentionally not a "use client" module: search result cards render these as
// server components, and the detail page renders them inside its client tree.

const interactiveClass =
  "transition duration-200 hover:border-violet-200 hover:text-violet-700 dark:hover:border-violet-800 dark:hover:text-violet-300";

const inlineClass =
  "transition duration-200 hover:text-violet-700 hover:underline dark:hover:text-violet-300";

/** Pill sizing without the base pill colours, which would fight the active ones. */
const activePillClass = `rounded-full border px-2.5 py-1 text-xs font-medium ${theme.marketplace.chipActive}`;

interface PostingFacetLinkProps {
  /** Without an href the value renders as plain text, exactly as before. */
  href?: string;
  label: string;
  /** `pill` keeps the caller's badge styling; `inline` sits inside running text. */
  variant?: "pill" | "inline";
  className?: string;
  active?: boolean;
  children: ReactNode;
}

export function PostingFacetLink({
  href,
  label,
  variant = "pill",
  className = "",
  active = false,
  children,
}: PostingFacetLinkProps) {
  if (!href) {
    return <span className={className || undefined}>{children}</span>;
  }

  const resolvedClassName =
    variant === "inline"
      ? `${className} ${inlineClass}`
      : active
        ? activePillClass
        : `${className} ${interactiveClass}`;

  return (
    <Link href={href} aria-label={label} className={resolvedClassName.trim()}>
      {children}
    </Link>
  );
}

/** "City, Region, Country" with each part linking to its own location filter. */
export function PostingLocationLinks({
  location,
  hrefFor,
}: {
  location: FacetLocation;
  hrefFor?: (level: LocationLevel) => string;
}) {
  const parts = LOCATION_LEVELS.flatMap((level) => {
    const value = location[level];
    return value ? [{ level, value }] : [];
  });

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.level}>
          {index > 0 ? ", " : null}
          <PostingFacetLink
            variant="inline"
            href={hrefFor?.(part.level)}
            label={`Filter by ${part.level} ${part.value}`}
          >
            {part.value}
          </PostingFacetLink>
        </Fragment>
      ))}
    </>
  );
}
