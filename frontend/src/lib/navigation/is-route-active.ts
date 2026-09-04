/**
 * Whether `pathname` is `href` or nested under it. Shared by the site header
 * nav, the app-shell sidebar, and the nav registry — it lives here rather than
 * in `site-header.shared.tsx` so plain `.ts` modules can use it without pulling
 * in React components.
 */
export function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
