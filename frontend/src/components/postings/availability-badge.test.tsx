import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvailabilityBadge } from "./availability-badge";

describe("AvailabilityBadge", () => {
  it.each([
    ["available", "Available", "border-emerald-200"],
    ["limited", "Limited", "border-amber-200"],
    ["unavailable", "Unavailable", "border-slate-200"],
  ] as const)(
    "renders the %s state label and styling",
    (status, label, className) => {
      render(<AvailabilityBadge status={status} />);

      expect(screen.getByText(label)).toHaveClass(className);
    },
  );
});
