import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

describe("ContentSanitizationService", () => {
  const service = new ContentSanitizationService();

  it("accepts ordinary posting text", () => {
    const violations = service.inspect([
      {
        path: "description",
        value:
          "Bright two bedroom apartment with parking and in-suite laundry.",
      },
      {
        path: "tags.0",
        value: "pet-friendly",
      },
    ]);

    expect(violations).toEqual([]);
  });

  it("rejects html and preserves the offending path", () => {
    const violations = service.inspect([
      {
        path: "description",
        value: "<script>alert('xss')</script>",
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe("description");
    expect(violations[0]?.code).toBe("UNSAFE_MARKUP");
  });

  it("rejects profanity", () => {
    const violations = service.inspect([
      {
        path: "name",
        value: "No shitty roommates please",
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe("name");
    expect(violations[0]?.code).toBe("PROFANITY");
  });

  it("rejects control characters", () => {
    const violations = service.inspect([
      {
        path: "availabilityNotes",
        value: "Available now\u0007",
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe("availabilityNotes");
    expect(violations[0]?.code).toBe("CONTROL_CHARACTER");
  });

  it("rejects obvious injection markers", () => {
    const violations = service.inspect([
      {
        path: "details.entryCode",
        value: "' OR 1=1 --",
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe("details.entryCode");
    expect(violations[0]?.code).toBe("INJECTION_PATTERN");
  });
});
