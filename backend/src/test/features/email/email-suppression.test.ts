import { environment } from "@/configuration/environment";
import { isSuppressedRecipient } from "@/features/email/email-suppression";

describe("isSuppressedRecipient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockNonProduction() {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
  }

  it("returns false for null email", () => {
    mockNonProduction();
    expect(isSuppressedRecipient(null)).toBe(false);
  });

  it("returns false for undefined email", () => {
    mockNonProduction();
    expect(isSuppressedRecipient(undefined)).toBe(false);
  });

  it("returns false when running in production regardless of email", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    expect(isSuppressedRecipient("owner1@rentify.local")).toBe(false);
  });

  it("returns true for a recipient on the non-deliverable rentify.local domain", () => {
    mockNonProduction();
    expect(isSuppressedRecipient("owner1@rentify.local")).toBe(true);
  });

  it("normalizes casing and surrounding whitespace before matching", () => {
    mockNonProduction();
    expect(isSuppressedRecipient("  Owner1@Rentify.Local  ")).toBe(true);
  });

  it("returns false for real deliverable domains", () => {
    mockNonProduction();
    expect(isSuppressedRecipient("user@example.com")).toBe(false);
  });

  it("returns false for a malformed address without a domain", () => {
    mockNonProduction();
    expect(isSuppressedRecipient("not-an-email")).toBe(false);
  });
});
