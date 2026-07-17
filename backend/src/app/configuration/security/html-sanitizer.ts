import { FilterXSS } from "xss";

/**
 * Allowlist-based sanitizer for user-authored rich text (e.g. organization blog
 * post bodies produced by the WYSIWYG editor). This is the authoritative server
 * side sanitization step: bodies are sanitized on create/update before they are
 * persisted, so any HTML read back (including by the public, unauthenticated
 * blog pages) is already safe to render.
 *
 * The allowlist intentionally covers the formatting the editor can emit
 * (headings, emphasis, lists, links, images, blockquotes, code) and nothing
 * else. Unknown tags are stripped, and the contents of dangerous tags such as
 * <script>/<style> are discarded entirely. `xss` also blocks unsafe URL schemes
 * (e.g. javascript:) in href/src via its default `safeAttrValue`.
 */
const RICH_TEXT_WHITELIST: Record<string, string[]> = {
  p: [],
  br: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  blockquote: [],
  ul: [],
  ol: [],
  li: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  code: [],
  pre: [],
  hr: [],
  a: ["href", "title", "target"],
  img: ["src", "alt", "title"],
};

const richTextFilter = new FilterXSS({
  whiteList: RICH_TEXT_WHITELIST,
  stripIgnoreTag: true,
  // Drop the *contents* of these tags, not just the tags themselves. xss'
  // default `safeAttrValue` also strips unsafe URL schemes (e.g. javascript:).
  stripIgnoreTagBody: ["script", "style"],
});

const plainTextFilter = new FilterXSS({
  whiteList: {},
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"],
});

export function sanitizeRichText(html: string): string {
  return ensureAnchorRel(richTextFilter.process(html)).trim();
}

// Harden every anchor against tab-nabbing / referrer leakage. xss has already
// sanitized the href scheme; here we just guarantee a safe rel is present.
function ensureAnchorRel(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
    if (/\srel\s*=/i.test(attrs)) {
      return match;
    }
    return `<a${attrs} rel="noopener noreferrer nofollow">`;
  });
}

/**
 * Strips all HTML, returning readable plain text. Useful for deriving a
 * fallback excerpt / search text from a rich-text body.
 */
export function htmlToPlainText(html: string): string {
  return decodeBasicEntities(plainTextFilter.process(html))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
