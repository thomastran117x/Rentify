import Link from "next/link";

export type SavedTab = "postings" | "searches";

const tabs = [
  { id: "postings" as const, href: "/saved", label: "Postings" },
  { id: "searches" as const, href: "/saved/searches", label: "Searches" },
];

const baseClasses =
  "rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";
const activeClasses =
  "bg-slate-950 text-white dark:bg-white dark:text-slate-950";
const inactiveClasses =
  "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";

/**
 * Switches between the two halves of the saved area.
 *
 * Plain links rather than client-side tab state: each half is its own route, so
 * a visitor can link straight to their saved searches, and the browser back
 * button moves between the two the way they expect.
 */
export function SavedTabs({ active }: { active: SavedTab }) {
  return (
    <nav aria-label="Saved" className="flex gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={`${baseClasses} ${
            active === tab.id ? activeClasses : inactiveClasses
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
