import { describe, expect, it } from "vitest";
import { validateOrganizationSlug } from "@/components/organizations/workspace/forms";

describe("validateOrganizationSlug", () => {
  it("accepts a well-formed slug", () => {
    expect(validateOrganizationSlug("harbor-rentals")).toBeNull();
    expect(validateOrganizationSlug("harbor2")).toBeNull();
  });

  it("accepts a slug typed with capitals or padding", () => {
    // The field normalizes before submitting, so this must not read as an error.
    expect(validateOrganizationSlug("  Harbor-Rentals  ")).toBeNull();
  });

  it("rejects spaces and other unsupported characters", () => {
    expect(validateOrganizationSlug("Not A Slug")).toMatch(/lowercase/i);
    expect(validateOrganizationSlug("harbor_rentals")).toMatch(/lowercase/i);
  });

  it("rejects leading, trailing, and doubled hyphens", () => {
    expect(validateOrganizationSlug("-harbor")).not.toBeNull();
    expect(validateOrganizationSlug("harbor-")).not.toBeNull();
    expect(validateOrganizationSlug("harbor--rentals")).not.toBeNull();
  });

  it("enforces the length bounds", () => {
    expect(validateOrganizationSlug("a")).toMatch(/at least/i);
    expect(validateOrganizationSlug("a".repeat(161))).toMatch(/at most/i);
    expect(validateOrganizationSlug("a".repeat(160))).toBeNull();
  });

  it("rejects a slug shaped like an organization id", () => {
    // Otherwise it would shadow a real id lookup.
    expect(
      validateOrganizationSlug("00000000-0000-0000-1040-000000000001"),
    ).toMatch(/id/i);
  });

  it("rejects reserved slugs that would shadow a sibling route", () => {
    expect(validateOrganizationSlug("invitations")).toMatch(/reserved/i);
    expect(validateOrganizationSlug("by-slug")).toMatch(/reserved/i);
  });

  it("rejects the generated id namespace", () => {
    expect(
      validateOrganizationSlug(`organization-id-${"a".repeat(32)}`),
    ).toMatch(/reserved/i);
  });
});
