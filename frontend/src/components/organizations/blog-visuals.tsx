import type { OrganizationBlogPostRecord } from "@/lib/organizations/api";

type BlogAuthor = OrganizationBlogPostRecord["author"];

/** Rough reading-time estimate from an HTML body, at ~200 words per minute. */
export function readingTimeMinutes(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text ? text.split(" ").length : 0;
  return Math.max(1, Math.round(words / 200));
}

function authorInitials(author: BlogAuthor): string {
  const source = author?.username || author?.email || "?";
  const parts = source
    .replace(/@.*$/, "")
    .split(/[.\-_\s]+/)
    .filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || source[0]?.toUpperCase() || "?";
}

const AVATAR_SIZES = {
  sm: "h-7 w-7 text-[0.65rem]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
} as const;

export function AuthorAvatar({
  author,
  size = "md",
}: {
  author: BlogAuthor;
  size?: keyof typeof AVATAR_SIZES;
}) {
  const dimension = AVATAR_SIZES[size];

  if (author?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={author.avatarUrl}
        alt=""
        className={`${dimension} shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-sky-500 font-semibold text-white`}
    >
      {authorInitials(author)}
    </span>
  );
}

export function authorName(author: BlogAuthor): string {
  return author?.username ?? "Rentify";
}
