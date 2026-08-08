import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AboutPage from "./about/page";
import AccessibilityPage from "./accessibility/page";
import ContactPage from "./contact/page";
import FaqPage from "./faq/page";
import HowItWorksPage from "./how-it-works/page";
import PrivacyPage from "./privacy/page";
import ServicesPage from "./services/page";
import TermsPage from "./terms/page";

vi.mock("@/components/marketing/marketing-hero-search", () => ({
  MarketingHeroSearch: () => <div data-testid="hero-search" />,
}));
vi.mock("@/components/marketing/contact-inquiry-form", () => ({
  ContactInquiryForm: () => <form aria-label="Contact inquiry" />,
}));

describe("marketing pages", () => {
  it.each([
    [
      AboutPage,
      "We built Rentify to make rental discovery feel clearer from the first click.",
    ],
    [
      AccessibilityPage,
      "Rentify should be usable by more people, on more devices, with fewer barriers.",
    ],
    [
      ContactPage,
      "Reach out for support, and tell us how the Rentify app can improve.",
    ],
    [FaqPage, "Common questions, answered without the runaround."],
    [
      HowItWorksPage,
      "Rentify is built to help renters discover faster and owners present listings more clearly.",
    ],
    [
      PrivacyPage,
      "Our privacy policy is written to explain what Rentify collects and why.",
    ],
    [
      ServicesPage,
      "Marketplace services that support discovery, trust, and day-to-day rental operations.",
    ],
    [
      TermsPage,
      "These terms set expectations for using Rentify and interacting with listings on the marketplace.",
    ],
  ])("renders %s with its primary content", (Page, title) => {
    render(<Page />);

    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("hero-search")).toBeInTheDocument();
  });
});
