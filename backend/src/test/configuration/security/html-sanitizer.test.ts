import {
  htmlToPlainText,
  sanitizeRichText,
} from "@/configuration/security/html-sanitizer";

describe("sanitizeRichText", () => {
  it("keeps allowlisted formatting tags", () => {
    const input =
      "<h2>Title</h2><p>Hello <strong>world</strong> and <em>everyone</em>.</p><ul><li>One</li></ul>";
    expect(sanitizeRichText(input)).toBe(input);
  });

  it("removes script tags and their contents", () => {
    const output = sanitizeRichText('<p>Safe</p><script>alert("xss")</script>');
    expect(output).toBe("<p>Safe</p>");
  });

  it("removes style tags and their contents", () => {
    const output = sanitizeRichText("<p>Safe</p><style>body{}</style>");
    expect(output).toBe("<p>Safe</p>");
  });

  it("strips javascript: urls from links", () => {
    const output = sanitizeRichText('<a href="javascript:alert(1)">bad</a>');
    expect(output).not.toContain("javascript:");
  });

  it("keeps safe https links and hardens them with rel", () => {
    const output = sanitizeRichText(
      '<a href="https://example.com" target="_blank">link</a>',
    );
    expect(output).toContain('href="https://example.com"');
    expect(output).toContain('rel="noopener noreferrer nofollow"');
  });

  it("normalizes any author-supplied rel to the safe value", () => {
    const output = sanitizeRichText(
      '<a href="https://example.com" rel="me">link</a>',
    );
    // The allowlist drops the incoming rel, then a safe rel is enforced.
    expect(output).toContain('rel="noopener noreferrer nofollow"');
    expect(output).not.toContain('rel="me"');
  });

  it("drops inline event handlers", () => {
    const output = sanitizeRichText('<p onclick="steal()">Hi</p>');
    expect(output).not.toContain("onclick");
    expect(output).toContain("Hi");
  });

  it("strips unknown tags but keeps their text", () => {
    const output = sanitizeRichText("<marquee>Move</marquee>");
    expect(output).not.toContain("<marquee>");
    expect(output).toContain("Move");
  });
});

describe("htmlToPlainText", () => {
  it("removes markup and collapses whitespace", () => {
    expect(htmlToPlainText("<h2>Title</h2>\n<p>Hello   world</p>")).toBe(
      "Title Hello world",
    );
  });

  it("decodes basic entities", () => {
    expect(htmlToPlainText("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
  });

  it("returns an empty string for markup-only input", () => {
    expect(htmlToPlainText("<script>alert(1)</script>")).toBe("");
  });
});
