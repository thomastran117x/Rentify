export const DEFAULT_NEXT_PATH = "/";

// A fixed base keeps the check deterministic on the server and in the browser.
// All that matters is whether the value still resolves to the same origin, not
// which origin that is.
const INTERNAL_ORIGIN = "http://rentify.internal";

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Returns `value` when it is a same-origin path that is safe to navigate to
 * after sign-in, and `fallback` otherwise. Rejects absolute and
 * protocol-relative URLs, backslashes (which URL parsing treats as slashes),
 * and control characters (which URL parsing strips, so `/\t/host` would
 * become `//host`).
 */
export function safeNextPath(
  value: unknown,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) {
      return fallback;
    }
    // Removing dot segments can expose a protocol-relative path, e.g.
    // "/a/..//example.org" normalizes to "//example.org".
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("//") ? fallback : path;
  } catch {
    return fallback;
  }
}
