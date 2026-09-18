import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentOutcomePanel } from "./payment-outcome";

describe("PaymentOutcomePanel", () => {
  it("renders a full page shell with actions by default", () => {
    render(
      <PaymentOutcomePanel
        icon={<span>icon</span>}
        title="Paid"
        description="Done."
      >
        <button type="button">Next</button>
      </PaymentOutcomePanel>,
    );

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("renders only the card when embedded", () => {
    render(
      <PaymentOutcomePanel
        embedded
        icon={<span>icon</span>}
        title="Loading"
        description="Wait."
      />,
    );

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByText("Wait.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
