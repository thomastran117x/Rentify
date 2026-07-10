import { theme } from "@/styles/theme";

interface SiteFooterMetaBarProps {
  currentYear: number;
}

export function SiteFooterMetaBar({ currentYear }: SiteFooterMetaBarProps) {
  return (
    <div className={theme.footer.metaBar}>
      <p>&copy; {currentYear} Rentify. All rights reserved.</p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Built for renters, by renters.
      </p>
    </div>
  );
}
