import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExpiryChip } from "@/components/postings/expiry-chip";

function futureIso(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(23, 59, 59, 999);

  return date.toISOString();
}

describe("ExpiryChip", () => {
  it("renders nothing when the listing never expires", () => {
    const { container } = render(
      <ExpiryChip posting={{ status: "published" }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an archived posting", () => {
    const { container } = render(
      <ExpiryChip posting={{ status: "archived", expiresAt: futureIso(3) }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("labels an upcoming expiry", () => {
    render(
      <ExpiryChip posting={{ status: "published", expiresAt: futureIso(4) }} />,
    );

    expect(screen.getByText(/Expires in \d+ days/)).toBeInTheDocument();
  });

  it("labels a passed expiry on a paused posting", () => {
    render(
      <ExpiryChip
        posting={{ status: "paused", expiresAt: "2020-01-01T00:00:00.000Z" }}
      />,
    );

    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("exposes the exact date as a tooltip", () => {
    render(
      <ExpiryChip posting={{ status: "published", expiresAt: futureIso(4) }} />,
    );

    const title = screen.getByText(/Expires in \d+ days/).getAttribute("title");

    expect(title).toMatch(/^Expires \w+ \d+, \d{4}$/);
  });
});
