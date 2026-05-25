import Link from "next/link";
import { theme } from "@/styles/theme";
import { footerLinkGroups, type FooterLinkItem } from "./site-footer.shared";

interface FooterLinkGroupProps {
  title: string;
  links: ReadonlyArray<FooterLinkItem>;
}

function FooterLinkGroup({ title, links }: FooterLinkGroupProps) {
  return (
    <div>
      <p className={theme.footer.sectionTitle}>{title}</p>

      <nav className={theme.footer.linkList}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={theme.footer.link}>
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function SiteFooterLinkGroups() {
  return (
    <div className={theme.footer.linkGroupsWrapper}>
      {footerLinkGroups.map((group) => (
        <FooterLinkGroup
          key={group.title}
          title={group.title}
          links={group.links}
        />
      ))}
    </div>
  );
}
