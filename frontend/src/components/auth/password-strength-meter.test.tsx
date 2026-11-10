import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PasswordCheck } from "@/lib/auth/use-password-check";
import {
  PasswordStrengthMeter,
  estimatePasswordStrength,
} from "./password-strength-meter";

const IDLE: PasswordCheck = { status: "idle", issues: [], warnings: [] };
const CHECKED: PasswordCheck = { status: "checked", issues: [], warnings: [] };
const BREACHED_ISSUE = {
  code: "breached" as const,
  message: "This password has appeared in a known data breach.",
};

describe("estimatePasswordStrength", () => {
  it("has nothing to say about an empty password", () => {
    expect(estimatePasswordStrength("", {}, IDLE)).toBeNull();
  });

  it("calls anything the rules refuse too weak", () => {
    expect(estimatePasswordStrength("short", {}, IDLE)).toEqual({
      score: 0,
      label: "Too weak",
    });
    expect(
      estimatePasswordStrength(
        "all-about-taylor",
        { username: "taylor" },
        IDLE,
      ),
    ).toMatchObject({ score: 0 });
    expect(
      estimatePasswordStrength(
        "tidal-harbor-lantern",
        {},
        {
          ...CHECKED,
          issues: [BREACHED_ISSUE],
        },
      ),
    ).toMatchObject({ score: 0 });
  });

  it("grades acceptable passwords by length and mix", () => {
    expect(estimatePasswordStrength("abcdefghijkx", {}, CHECKED)).toEqual({
      score: 1,
      label: "Fair",
    });
    expect(estimatePasswordStrength("abcdefghijklmnox", {}, CHECKED)).toEqual({
      score: 2,
      label: "Good",
    });
    expect(
      estimatePasswordStrength("tidal harbor lanterns", {}, CHECKED),
    ).toEqual({ score: 3, label: "Strong" });
    expect(
      estimatePasswordStrength("Tidal-Harbor-Lantern-7", {}, CHECKED),
    ).toEqual({ score: 4, label: "Very strong" });
  });

  it("caps a password with a breach warning at fair", () => {
    expect(
      estimatePasswordStrength(
        "Tidal-Harbor-Lantern-7",
        {},
        {
          ...CHECKED,
          warnings: [BREACHED_ISSUE],
        },
      ),
    ).toEqual({ score: 1, label: "Fair" });
  });
});

describe("PasswordStrengthMeter", () => {
  it("renders nothing for an empty password", () => {
    const { container } = render(
      <PasswordStrengthMeter id="meter" password="" check={IDLE} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("announces the grade politely", () => {
    render(
      <PasswordStrengthMeter
        id="meter"
        password="Tidal-Harbor-Lantern-7"
        check={CHECKED}
      />,
    );

    const label = screen.getByText("Strength: Very strong");
    expect(label).toHaveAttribute("aria-live", "polite");
    expect(document.getElementById("meter")).toHaveAttribute("data-score", "4");
  });

  it("says when it is still checking", () => {
    render(
      <PasswordStrengthMeter
        id="meter"
        password="tidal-harbor-lantern"
        check={{ status: "checking", issues: [], warnings: [] }}
      />,
    );

    expect(
      screen.getByText("Checking against common and breached passwords…"),
    ).toBeInTheDocument();
  });

  it("lists the server's issues and warnings, unless the field shows them", () => {
    const check: PasswordCheck = {
      status: "checked",
      issues: [BREACHED_ISSUE],
      warnings: [{ code: "breached", message: "Consider another." }],
    };
    const { rerender } = render(
      <PasswordStrengthMeter
        id="meter"
        password="tidal-harbor-lantern"
        check={check}
      />,
    );

    expect(screen.getByText(BREACHED_ISSUE.message)).toHaveAttribute(
      "data-issue",
      "breached",
    );
    expect(screen.getByText("Consider another.")).toHaveAttribute(
      "data-warning",
      "breached",
    );

    rerender(
      <PasswordStrengthMeter
        id="meter"
        password="tidal-harbor-lantern"
        check={check}
        hideIssues
      />,
    );
    expect(screen.queryByText(BREACHED_ISSUE.message)).not.toBeInTheDocument();
    expect(screen.getByText("Consider another.")).toBeInTheDocument();
  });
});
