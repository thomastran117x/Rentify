import { environment } from "@/configuration/environment";

export function isMfaBypassEligible(email: string | null | undefined): boolean {
  if (!email || environment.isProduction()) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return false;
  }

  return environment.getTokenConfig().mfaBypassEmails.includes(normalizedEmail);
}