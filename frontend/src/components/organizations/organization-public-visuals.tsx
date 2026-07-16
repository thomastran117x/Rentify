// Shared presentational helpers for the public organization directory and
// detail pages. Icons come from `lucide-react` and layout from
// `@/styles/theme` (theme.marketplace) so these surfaces match the postings
// marketplace design.

export function formatOrganizationDate(
  value: string,
  variant: "short" | "long" = "short",
): string {
  return new Intl.DateTimeFormat(undefined, {
    month: variant === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function getWebsiteHost(websiteUrl: string | null): string | null {
  if (!websiteUrl) {
    return null;
  }

  try {
    return new URL(websiteUrl).host.replace(/^www\./, "");
  } catch {
    return websiteUrl;
  }
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

interface OrganizationLogoProps {
  name: string;
  logoUrl: string | null;
  size?: "sm" | "md" | "lg";
}

const LOGO_SIZE_CLASS: Record<
  NonNullable<OrganizationLogoProps["size"]>,
  string
> = {
  sm: "h-12 w-12 rounded-xl text-sm",
  md: "h-16 w-16 rounded-2xl text-lg",
  lg: "h-20 w-20 rounded-[1.4rem] text-2xl",
};

export function OrganizationLogo({
  name,
  logoUrl,
  size = "md",
}: OrganizationLogoProps) {
  const sizeClass = LOGO_SIZE_CLASS[size];

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={`${sizeClass} shrink-0 object-cover ring-1 ring-slate-200 dark:ring-slate-700`}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`${sizeClass} grid shrink-0 place-items-center bg-gradient-to-br from-violet-500 to-indigo-600 font-semibold tracking-tight text-white ring-1 ring-white/20`}
    >
      {getInitials(name)}
    </div>
  );
}
