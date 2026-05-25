import { ExternalLink, Mail } from "lucide-react";

function InstagramIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="17.25" cy="6.75" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d="M13.5 21v-7h2.6l.4-3h-3v-1.9c0-.9.3-1.5 1.6-1.5h1.5V5c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 4V11H8v3h2.5v7h3Z" />
    </svg>
  );
}

export interface FooterLinkItem {
  href: string;
  label: string;
}

export interface FooterLinkGroupData {
  title: string;
  links: ReadonlyArray<FooterLinkItem>;
}

export const footerLinkGroups: ReadonlyArray<FooterLinkGroupData> = [
  {
    title: "Marketplace",
    links: [
      { href: "/postings", label: "Browse rentals" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/services", label: "Services" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/accessibility", label: "Accessibility" },
    ],
  },
];

export const footerSocialLinks = [
  {
    href: "mailto:hello@rentify.co",
    label: "Email",
    icon: Mail,
  },
  {
    href: "https://instagram.com",
    label: "Instagram",
    icon: InstagramIcon,
  },
  {
    href: "https://facebook.com",
    label: "Facebook",
    icon: FacebookIcon,
  },
  {
    href: "https://linkedin.com",
    label: "LinkedIn",
    icon: ExternalLink,
  },
] as const;
