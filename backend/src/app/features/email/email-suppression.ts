import { environment } from "@/configuration/environment";

const SUPPRESSED_EMAIL_DOMAINS = ["rentify.local"];

export function isSuppressedRecipient(
  email: string | null | undefined,
): boolean {
  if (!email || environment.isProduction()) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const atIndex = normalizedEmail.lastIndexOf("@");

  if (atIndex === -1) {
    return false;
  }

  return SUPPRESSED_EMAIL_DOMAINS.includes(normalizedEmail.slice(atIndex + 1));
}
