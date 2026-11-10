import type { OAuthProvider } from "@/features/auth/auth.model";
import type { SecurityChangeEmailJob } from "@/features/email/email.model";
import type {
  PasswordChangeKind,
  SecurityChangeEmailBase,
} from "@/features/email/email.service";

/** The part of a security-change email that depends on what changed. */
export interface SecurityChangeEmailContent {
  subject: string;
  heading: string;
  summary: string;
  /** Facts about the change itself, listed above when and where it came from. */
  details: string[];
}

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

const PASSWORD_CHANGE_CONTENT: Record<
  PasswordChangeKind,
  Pick<SecurityChangeEmailContent, "subject" | "heading" | "summary">
> = {
  changed: {
    subject: "Your Rentify password was changed",
    heading: "Your password was changed",
    summary:
      "The password on your Rentify account was just changed, and every other sign-in was ended.",
  },
  reset: {
    subject: "Your Rentify password was reset",
    heading: "Your password was reset",
    summary:
      "The password on your Rentify account was just reset with a code sent to this address, and every other sign-in was ended.",
  },
  set: {
    subject: "A password was added to your Rentify account",
    heading: "A password was added to your account",
    summary:
      "A password was just added to your Rentify account, so it can now be used to sign in. Every other sign-in was ended.",
  },
};

/** Exhaustive: a new kind does not compile until its wording is added here. */
export function composeSecurityChangeEmail(
  job: SecurityChangeEmailJob,
): SecurityChangeEmailContent {
  switch (job.kind) {
    case "password_changed":
      return { ...PASSWORD_CHANGE_CONTENT[job.input.change], details: [] };
    case "mfa_enabled":
      return {
        subject: "An authenticator app was added to your Rentify account",
        heading: "An authenticator app was added",
        summary:
          "An authenticator app was just added to your Rentify account. Signing in now needs a code from it.",
        details: [],
      };
    case "mfa_disabled":
      return {
        subject: "The authenticator app was removed from your Rentify account",
        heading: "Your authenticator app was removed",
        summary:
          job.input.endedOtherSessions === false
            ? "The authenticator app was just removed from your Rentify account. Signing in no longer needs a code from it, though your passkeys still work."
            : "The authenticator app was just removed from your Rentify account, and every other sign-in was ended. Signing in no longer needs a code from it.",
        details: [],
      };
    case "mfa_recovery_code_used":
      return {
        subject: "A recovery code was used on your Rentify account",
        heading: "A recovery code was used",
        summary:
          job.input.remaining === 0
            ? "A recovery code was just used on your Rentify account. That was your last one, so generate new codes from your security settings."
            : `A recovery code was just used on your Rentify account. Each code works once, and ${job.input.remaining} ${job.input.remaining === 1 ? "is" : "are"} left.`,
        details: [],
      };
    case "mfa_recovery_codes_regenerated":
      return {
        subject: "New recovery codes were generated for your Rentify account",
        heading: "New recovery codes were generated",
        summary:
          "New recovery codes were just generated for your Rentify account, and all of the old ones stopped working.",
        details: [],
      };
    case "passkey_added":
      return {
        subject: "A passkey was added to your Rentify account",
        heading: "A passkey was added",
        summary:
          "A passkey was just added to your Rentify account. It can now be used to confirm it's you when you sign in or make a security change.",
        details: [`Passkey: ${flattenName(job.input.passkeyName)}`],
      };
    case "passkey_removed":
      return {
        subject: "A passkey was removed from your Rentify account",
        heading: "A passkey was removed",
        summary: job.input.endedOtherSessions
          ? "A passkey was just removed from your Rentify account. It was the last one, and no authenticator app is set up, so every other sign-in was ended and your recovery codes stopped working."
          : "A passkey was just removed from your Rentify account, so it can no longer be used to confirm it's you.",
        details: [`Passkey: ${flattenName(job.input.passkeyName)}`],
      };
    case "personal_access_token_created":
      return {
        subject: "A personal access token was created on your Rentify account",
        heading: "A personal access token was created",
        summary:
          "A personal access token was just created on your Rentify account. It can act on the account without signing in.",
        details: [
          // Whoever created the token chose this name, and validation allows a
          // line break, which could otherwise forge lines of this email.
          `Token name: ${job.input.tokenName.replace(/\s+/g, " ")}`,
          `Scopes: ${job.input.scopes.join(", ")}`,
          `Expires: ${job.input.expiresAt ? formatTime(job.input.expiresAt) : "never"}`,
        ],
      };
    case "login_method_linked": {
      const provider = PROVIDER_LABELS[job.input.provider];

      return {
        subject: `${provider} was linked to your Rentify account`,
        heading: `${provider} was linked to your account`,
        summary: `A ${provider} account was just linked to your Rentify account, so it can now be used to sign in.`,
        details: [],
      };
    }
    case "login_method_unlinked": {
      const provider = PROVIDER_LABELS[job.input.provider];

      return {
        subject: `${provider} was unlinked from your Rentify account`,
        heading: `${provider} was unlinked from your account`,
        summary: `The ${provider} account linked to your Rentify account was just removed, so it can no longer be used to sign in.`,
        details: [],
      };
    }
    case "email_changed":
      return {
        subject: "The email on your Rentify account was changed",
        heading: "Your account email was changed",
        summary: `Your Rentify account now uses ${job.input.newEmail}, and this address no longer receives its emails.`,
        details: [],
      };
  }
}

/**
 * A name the account holder chose. Validation already refuses control
 * characters, but a name from an older row must not forge lines either.
 */
function flattenName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** When and where the change came from, for every kind. */
export function buildSecurityChangeContextDetails(
  input: Pick<SecurityChangeEmailBase, "occurredAt" | "device" | "ipAddress">,
): string[] {
  return [
    `Time: ${formatTime(input.occurredAt)}`,
    ...(input.device ? [`Device: ${input.device}`] : []),
    ...(input.ipAddress ? [`IP address: ${input.ipAddress}`] : []),
  ];
}

function formatTime(value: string): string {
  return new Date(value).toUTCString();
}
