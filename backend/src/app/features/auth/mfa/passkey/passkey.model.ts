import { z } from "zod";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/** How long a registration or assertion challenge stays usable. */
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;

/** How many passkeys one account can hold. */
export const MAX_PASSKEYS_PER_USER = 10;

export const PASSKEY_NAME_MAX_LENGTH = 64;

/**
 * Transports a browser may report. Anything else is dropped rather than
 * stored, since the list is echoed back to browsers as a hint.
 */
export const PASSKEY_TRANSPORTS = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
] as const;

export type PasskeyTransport = (typeof PASSKEY_TRANSPORTS)[number];

export type PasskeyDeviceType = "single_device" | "multi_device";

/**
 * A base64url value as the browser library sends it. The cap is generous: the
 * largest field, an attestation object with a certificate chain, stays well
 * under it, and the request body limit applies first anyway.
 */
const base64UrlString = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]+$/, "Must be base64url-encoded.");

const clientExtensionResults = z
  .record(z.string(), z.unknown())
  .optional()
  .transform((value) => value ?? {});

const authenticatorAttachment = z.enum(["platform", "cross-platform"]);

/**
 * Only the outer shape is checked here; `@simplewebauthn/server` decodes and
 * verifies everything inside, and a value it cannot verify is refused there.
 */
export const passkeyRegistrationCredentialSchema = z.object({
  id: base64UrlString,
  rawId: base64UrlString,
  type: z.literal("public-key"),
  authenticatorAttachment: authenticatorAttachment.optional(),
  clientExtensionResults,
  response: z.object({
    clientDataJSON: base64UrlString,
    attestationObject: base64UrlString,
    authenticatorData: base64UrlString.optional(),
    transports: z.array(z.string().max(32)).max(16).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64UrlString.optional(),
  }),
});

export const passkeyAssertionCredentialSchema = z.object({
  id: base64UrlString,
  rawId: base64UrlString,
  type: z.literal("public-key"),
  authenticatorAttachment: authenticatorAttachment.optional(),
  clientExtensionResults,
  response: z.object({
    clientDataJSON: base64UrlString,
    authenticatorData: base64UrlString,
    signature: base64UrlString,
    userHandle: base64UrlString.optional(),
  }),
});

export const passkeyNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(
    PASSKEY_NAME_MAX_LENGTH,
    `Name must be at most ${PASSKEY_NAME_MAX_LENGTH} characters.`,
  )
  // The name goes into a security email, where a line break would let it
  // forge lines of its own.
  .refine(
    (value) => !/\p{Cc}/u.test(value),
    "Name cannot contain control characters.",
  );

export const passkeyRegistrationOptionsRequestSchema = z.object({});

export const passkeyRegistrationVerifyRequestSchema = z.object({
  credential: passkeyRegistrationCredentialSchema,
  name: passkeyNameSchema.optional(),
});

export const passkeyRenameRequestSchema = z.object({
  name: passkeyNameSchema,
});

/**
 * Checked against `RegistrationResponseJSON` at compile time, so the schema
 * cannot drift from what the library verifies.
 */
export type PasskeyRegistrationCredential = z.infer<
  typeof passkeyRegistrationCredentialSchema
> &
  RegistrationResponseJSON;

export type PasskeyAssertionCredential = z.infer<
  typeof passkeyAssertionCredentialSchema
> &
  AuthenticationResponseJSON;

/** What the account page shows. The key and credential ID never leave. */
export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
  deviceType: PasskeyDeviceType;
  transports: PasskeyTransport[];
}

export interface PasskeyListResult {
  passkeys: PasskeySummary[];
}

export interface PasskeyRegistrationOptionsResult {
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface PasskeyRegistrationResult {
  passkey: PasskeySummary;
}

export interface PasskeyAssertionOptionsResult {
  options: PublicKeyCredentialRequestOptionsJSON;
}

/** A credential row ready to insert. */
export interface NewPasskeyRow {
  id: string;
  userId: string;
  credentialId: Uint8Array<ArrayBuffer>;
  publicKey: Uint8Array<ArrayBuffer>;
  signCount: number;
  transports: PasskeyTransport[];
  aaguid: string;
  backedUp: boolean;
  deviceType: PasskeyDeviceType;
  name: string;
}

export function toPasskeyTransports(
  values: readonly string[] | undefined,
): PasskeyTransport[] {
  return [
    ...new Set(
      (values ?? []).filter((value): value is PasskeyTransport =>
        (PASSKEY_TRANSPORTS as readonly string[]).includes(value),
      ),
    ),
  ];
}

export function toPasskeyDeviceType(
  value: "singleDevice" | "multiDevice",
): PasskeyDeviceType {
  return value === "multiDevice" ? "multi_device" : "single_device";
}
