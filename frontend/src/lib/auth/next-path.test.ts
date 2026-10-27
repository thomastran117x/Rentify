import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, safeNextPath } from "./next-path";

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);

describe("safeNextPath", () => {
  it.each([
    "/",
    "/dashboard",
    "/organizations/invitations/token-123",
    "/postings?q=kayak&family=equipment",
    "/account#security",
    "/postings/a:b",
  ])("keeps the same-origin path %s", (value) => {
    expect(safeNextPath(value)).toBe(value);
  });

  it("normalizes dot segments without leaving the origin", () => {
    expect(safeNextPath("/a/../../dashboard")).toBe("/dashboard");
  });

  it.each([
    ["an absolute URL", "https://example.org"],
    ["an absolute URL with a path", "https://attacker.example/rentify-login"],
    ["a scheme without slashes", "http:example.org"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a protocol-relative URL", "//example.org"],
    ["a slash-backslash prefix", "/\\example.org"],
    ["a double backslash", "\\\\example.org"],
    ["a backslash later in the path", "/foo\\..\\\\example.org"],
    ["a still-encoded protocol-relative URL", "%2F%2Fexample.org"],
    ["a bare host", "example.org"],
    ["a tab that URL parsing strips", `/${TAB}/example.org`],
    ["a newline that URL parsing strips", `/${NEWLINE}/example.org`],
    ["a NUL character", `/dashboard${NUL}`],
    ["a DEL character", `/dashboard${DEL}`],
    ["a leading space", " /dashboard"],
    ["an empty string", ""],
  ])("falls back to / for %s", (_label, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH);
  });

  it.each([undefined, null, 42, ["/a", "/b"], { path: "/a" }])(
    "falls back to / for the non-string value %j",
    (value) => {
      expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH);
    },
  );

  it("uses a custom fallback when one is given", () => {
    expect(safeNextPath("//example.org", "/dashboard")).toBe("/dashboard");
  });
});
