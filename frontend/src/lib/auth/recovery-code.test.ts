import { describe, expect, it } from "vitest";
import {
  formatRecoveryCodeInput,
  isCompleteRecoveryCode,
} from "./recovery-code";

describe("formatRecoveryCodeInput", () => {
  it.each([
    ["abc", "ABC"],
    ["abcde", "ABCDE"],
    ["abcdef", "ABCDE-F"],
    ["abcde-fgh23", "ABCDE-FGH23"],
    ["ABCDE FGH23", "ABCDE-FGH23"],
    [" abcdefgh23 ", "ABCDE-FGH23"],
    ["ABCDE-FGH23-EXTRA", "ABCDE-FGH23"],
    ["", ""],
  ])("turns %j into %j", (input, expected) => {
    expect(formatRecoveryCodeInput(input)).toBe(expected);
  });
});

describe("isCompleteRecoveryCode", () => {
  it("needs all ten characters, however they are separated", () => {
    expect(isCompleteRecoveryCode("ABCDE-FGH23")).toBe(true);
    expect(isCompleteRecoveryCode("abcdefgh23")).toBe(true);
    expect(isCompleteRecoveryCode("ABCDE-FGH2")).toBe(false);
    expect(isCompleteRecoveryCode("")).toBe(false);
  });
});
