import Link from "next/link";
import { theme } from "@/styles/theme";
import { isRouteActive, navigationLinks } from "./site-header.shared";

interface SiteHeaderDesktopNavProps {
  pathname: string;
}

export function SiteHeaderDesktopNav({ pathname }: SiteHeaderDesktopNavProps) {
  return (
    <nav className={theme.header.desktopNav}>
      {navigationLinks.map((link) => {
        const active = isRouteActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active ? theme.header.navLinkActive : theme.header.navLink
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

interface SiteHeaderMobileNavGridProps {
  pathname: string;
}

export function SiteHeaderMobileNavGrid({
  pathname,
}: SiteHeaderMobileNavGridProps) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {navigationLinks.map((link) => {
        const active = isRouteActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? theme.header.mobileNavLinkActive
                : theme.header.mobileNavLink
            }
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
