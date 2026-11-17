"use client";

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};

/**
 * What came of a browser passkey prompt. Closing it, letting it time out, or
 * having no matching passkey all look the same to the page, and none of them
 * is an error worth alarming anyone about, so they come back as `cancelled`.
 */
export type PasskeyCeremonyResult<TCredential> =
  | { status: "completed"; credential: TCredential }
  | { status: "cancelled" };

/** A prompt that failed for a reason the user should be told. */
export class PasskeyCeremonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyCeremonyError";
  }
}

export function supportsPasskeys(): boolean {
  try {
    return typeof window !== "undefined" && browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

function isCancellation(error: unknown): boolean {
  if (
    error instanceof WebAuthnError &&
    error.code === "ERROR_CEREMONY_ABORTED"
  ) {
    return true;
  }

  return (
    error instanceof Error &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

function toCeremonyError(error: unknown): PasskeyCeremonyError {
  if (
    error instanceof WebAuthnError &&
    error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
  ) {
    return new PasskeyCeremonyError("This passkey is already on your account.");
  }

  if (
    error instanceof WebAuthnError &&
    (error.code === "ERROR_INVALID_DOMAIN" ||
      error.code === "ERROR_INVALID_RP_ID")
  ) {
    return new PasskeyCeremonyError(
      "Passkeys can't be used from this address. Open Rentify from its usual address and try again.",
    );
  }

  return new PasskeyCeremonyError(
    "Your browser couldn't use a passkey just now. Try again, or use another method.",
  );
}

async function runCeremony<TCredential>(
  ceremony: () => Promise<TCredential>,
): Promise<PasskeyCeremonyResult<TCredential>> {
  if (!supportsPasskeys()) {
    throw new PasskeyCeremonyError("This browser can't use passkeys.");
  }

  try {
    return { status: "completed", credential: await ceremony() };
  } catch (error) {
    if (isCancellation(error)) {
      return { status: "cancelled" };
    }

    throw toCeremonyError(error);
  }
}

/** Asks the browser to create a passkey for the given options. */
export function createPasskey(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
): Promise<PasskeyCeremonyResult<RegistrationResponseJSON>> {
  return runCeremony(() => startRegistration({ optionsJSON }));
}

/**
 * Whether the browser can offer passkeys in a field's autofill (WebAuthn
 * conditional mediation), for a field with `autocomplete="username webauthn"`.
 */
export async function supportsPasskeyAutofill(): Promise<boolean> {
  if (!supportsPasskeys()) {
    return false;
  }

  try {
    return await browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

/**
 * Asks the browser to sign the given challenge with one of the account's
 * passkeys, or, with `autofill`, with whichever passkey the user picks from
 * the username field's autofill. An autofill request waits until a passkey
 * is picked, and starting any other prompt cancels it.
 */
export function getPasskeyAssertion(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  { autofill = false }: { autofill?: boolean } = {},
): Promise<PasskeyCeremonyResult<AuthenticationResponseJSON>> {
  return runCeremony(() =>
    startAuthentication(
      autofill ? { optionsJSON, useBrowserAutofill: true } : { optionsJSON },
    ),
  );
}

/** Cancels whichever passkey prompt or autofill request is waiting. */
export function cancelPasskeyCeremony(): void {
  WebAuthnAbortService.cancelCeremony();
}
