import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import {
  compileContentScreeningTerms,
  parseContentScreeningTerms,
} from "@/features/security/content-screening-terms";

describe("ContentSanitizationService", () => {
  const service = new ContentSanitizationService();

  function inspectProse(value: string) {
    return service.inspect([{ path: "description", value }]);
  }

  function inspectUsername(value: string) {
    return service.inspectUsername([{ path: "username", value }]);
  }

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

  it.each([
    "Total bullshit",
    "What a motherfucker",
    "sh1t landlord",
    "a$$ of a place",
    "what the fuuuuuck",
    "f u c k this",
    "s.h.i.t neighbours",
    "\uFF26\uFF35\uFF23\uFF2B",
    "sh\u200Bit",
    "sh\u00EFt",
    "\u0441unt",
    "big ass yard",
  ])("rejects disguised or embedded profanity in prose: %s", (value) => {
    expect(inspectProse(value)).toEqual([
      expect.objectContaining({ path: "description", code: "PROFANITY" }),
    ]);
  });

  it.each([
    "Cockpit-view loft near Scunthorpe",
    "Classic grass tennis courts",
    "Assessment of the property available",
    "Fresh shiitake at the market",
    "$1200/month, unit 4827, 1st floor!",
    "Cocktail bar downstairs",
    "Fire retardant carpets throughout",
    "Therapist office on the ground floor",
    "Contact the admin team for support",
    "A trip to Scunthorpe",
  ])("accepts benign prose: %s", (value) => {
    expect(inspectProse(value)).toEqual([]);
  });

  it.each([
    "friendlyshittyperson",
    "FriendlyShittyPerson",
    "sh1tlord",
    "fuuuck",
    "scunthorpe-cunt",
    "big-ass",
    "admin",
    "admin1",
    "rentify-support",
    "rentifysupport",
    "system_root",
  ])("rejects inappropriate or reserved usernames: %s", (value) => {
    expect(inspectUsername(value)).toEqual([
      expect.objectContaining({ path: "username", code: "PROFANITY" }),
    ]);
  });

  it.each([
    "scunthorpe",
    "badminton-fan",
    "classic-grass",
    "class-clown",
    "cocktail-lover",
    "assessment-pro",
    "bright-otter-4827",
    "owner-one",
  ])("accepts benign usernames: %s", (value) => {
    expect(inspectUsername(value)).toEqual([]);
  });

  it("uses an injected term bank", () => {
    const customService = new ContentSanitizationService(
      compileContentScreeningTerms(
        parseContentScreeningTerms(
          "[substrings]\nzorp\n[words]\nblap\n[reserved-usernames]\nboss\n",
        ),
      ),
    );

    expect(
      customService.inspect([{ path: "body", value: "megazorp blap" }]),
    ).toHaveLength(1);
    expect(
      customService.inspect([{ path: "body", value: "No shitty roommates" }]),
    ).toEqual([]);
    expect(
      customService.inspectUsername([{ path: "username", value: "the-boss" }]),
    ).toHaveLength(1);
  });

  it("screens long adversarial input quickly", () => {
    const startedAt = performance.now();

    inspectProse(`${"a".repeat(10_000)}${"s ".repeat(5_000)}`);
    inspectProse(`${"as".repeat(10_000)}!`);
    inspectUsername("s".repeat(20_000));

    expect(performance.now() - startedAt).toBeLessThan(1_000);
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

  it("does not screen profanity for raw request inputs", () => {
    expect(
      service.inspectRequest([{ path: "query.q", value: "shitty" }]),
    ).toEqual([]);
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
