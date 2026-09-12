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

  it("rejects a blocked term embedded inside a username", () => {
    const violations = service.inspectUsername([
      {
        path: "username",
        value: "friendlyshittyperson",
      },
    ]);

    expect(violations).toEqual([
      expect.objectContaining({ path: "username", code: "PROFANITY" }),
    ]);
  });

  it("keeps substring screening scoped to usernames", () => {
    expect(
      service.inspect([{ path: "description", value: "A trip to Scunthorpe" }]),
    ).toEqual([]);
    expect(
      service.inspectUsername([{ path: "username", value: "scunthorpe" }]),
    ).toEqual([
      expect.objectContaining({ path: "username", code: "PROFANITY" }),
    ]);
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

  it("ignores inputs that are blank after trimming", () => {
    const violations = service.inspect([
      {
        path: "description",
        value: "   ",
      },
      {
        path: "title",
        value: "Clean title",
      },
    ]);

    expect(violations).toEqual([]);
  });
});
