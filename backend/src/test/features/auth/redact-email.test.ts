import { redactEmail } from "@/features/auth/redact-email";

describe("redactEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(redactEmail("user@example.com")).toBe("u***@example.com");
  });

  it("lowercases before redacting", () => {
    expect(redactEmail("USER@Example.COM")).toBe("u***@example.com");
  });

  it("returns a constant when there is no domain", () => {
    expect(redactEmail("invalid-email-without-domain")).toBe("redacted");
  });

  it("returns a constant when the local part is empty", () => {
    expect(redactEmail("@example.com")).toBe("redacted");
  });
});
