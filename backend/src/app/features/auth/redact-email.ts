/**
 * Reduces an email address to a shape that is safe to write to logs: enough to
 * correlate repeated activity from the same address, not enough to identify the
 * account holder.
 */
export function redactEmail(email: string): string {
  const [localPart, domain] = email.toLowerCase().split("@");

  if (!localPart || !domain) {
    return "redacted";
  }

  return `${localPart.slice(0, 1)}***@${domain}`;
}
