import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { environment } from "@/configuration/environment";
import { DEFAULT_SIGNING_KEY_ID } from "@/configuration/environment/constants";
import type { HmacSigningKey } from "@/configuration/environment/types";
import type {
  ClientRequestContext,
  DeviceBinding,
} from "@/configuration/http/bindings";
import { readCookie, writeCookie } from "@/configuration/http/request";
import { isSecureCookieEnabled } from "@/features/auth/auth.cookies";

/** The name used over plain http, where the `__Host-` prefix is unavailable. */
export const DEVICE_BINDING_COOKIE_NAME = "rentify_device";

/**
 * `__Host-` keeps a sibling subdomain from planting or overwriting the cookie,
 * as it does for the session cookies.
 */
export const SECURE_DEVICE_BINDING_COOKIE_NAME = "__Host-rentify_device";

/** Browsers cap a cookie's lifetime at 400 days; it is renewed at each sign-in. */
export const DEVICE_BINDING_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const ID_BYTES = 16;
// 16 bytes in unpadded base64url.
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Matches the signing-key kid rule, which has no '.'.
const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNING_CONTEXT = "device-binding:v1:";

function getKeys(): readonly HmacSigningKey[] {
  return environment.getTokenConfig().deviceBindingKeys;
}

function currentKey(keys: readonly HmacSigningKey[]): HmacSigningKey {
  const key = keys.find((candidate) => candidate.status === "current");

  if (!key) {
    throw new Error("The device binding keyset needs a current key.");
  }

  return key;
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNING_CONTEXT}${id}`)
    .digest("base64url");
}

/** A verified cookie: its binding id, and whether the current key signed it. */
export interface VerifiedDeviceBinding {
  id: string;
  /** Signed by a `next` or `previous` key; the cookie should be re-issued. */
  stale: boolean;
}

/**
 * The cookie value for a binding id: the id, the signing key's kid, and an
 * HMAC over the id. The id is random and chosen here, never by the client, so
 * knowing a device's id (from a log, an email or the device list) is not
 * enough to present it. The `default` kid is left out, so cookies keep their
 * pre-keyset form until a deployment rotates the key.
 */
export function signDeviceBindingId(
  id: string,
  keys: readonly HmacSigningKey[] = getKeys(),
): string {
  const key = currentKey(keys);
  const signature = sign(id, key.secret);

  return key.kid === DEFAULT_SIGNING_KEY_ID
    ? `${id}.${signature}`
    : `${id}.${key.kid}.${signature}`;
}

export function createDeviceBindingId(): string {
  return randomBytes(ID_BYTES).toString("base64url");
}

/**
 * The binding a cookie value carries, or undefined if it does not verify
 * against the keyset. A cookie without a kid was signed with the `default`
 * key. Any key in the set verifies, so rotating the key, under the signing
 * key runbook, drops no device.
 */
export function verifyDeviceBindingCookieValue(
  value: string | undefined,
  keys: readonly HmacSigningKey[] = getKeys(),
): VerifiedDeviceBinding | undefined {
  if (!value) {
    return undefined;
  }

  const parts = value.split(".");
  const [id, kid, signature] =
    parts.length === 2
      ? [parts[0], DEFAULT_SIGNING_KEY_ID, parts[1]]
      : parts.length === 3
        ? [parts[0], parts[1], parts[2]]
        : [];

  if (
    !id ||
    !kid ||
    !signature ||
    !ID_PATTERN.test(id) ||
    !KID_PATTERN.test(kid) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return undefined;
  }

  const key = keys.find((candidate) => candidate.kid === kid);

  if (!key) {
    return undefined;
  }

  const expected = Buffer.from(sign(id, key.secret));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? { id, stale: key.status !== "current" }
    : undefined;
}

export function getDeviceBindingCookieName(
  secure = isSecureCookieEnabled(),
): string {
  return secure
    ? SECURE_DEVICE_BINDING_COOKIE_NAME
    : DEVICE_BINDING_COOKIE_NAME;
}

/** The verified binding this request presented, if any. */
export function readDeviceBinding(request: Request): DeviceBinding | undefined {
  const verified = verifyDeviceBindingCookieValue(
    readCookie(request, getDeviceBindingCookieName()),
  );

  if (!verified) {
    return undefined;
  }

  return verified.stale
    ? { id: verified.id, stale: true }
    : { id: verified.id };
}

/**
 * Not cleared on sign-out: it names the browser, not the session, and a
 * browser that keeps it stays known to every account that verified it.
 */
export function writeDeviceBindingCookie(response: Response, id: string): void {
  const secure = isSecureCookieEnabled();

  writeCookie(
    response,
    getDeviceBindingCookieName(secure),
    signDeviceBindingId(id),
    {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "Lax",
      maxAge: DEVICE_BINDING_COOKIE_MAX_AGE_SECONDS,
    },
  );
}

/**
 * The client context without its binding, for responses that echo the
 * context back. The binding id is no secret from the browser that holds it,
 * but it is not part of any response contract.
 */
export function toPublicClientContext(
  client: ClientRequestContext,
): Omit<ClientRequestContext, "deviceBinding"> {
  const { deviceBinding: _deviceBinding, ...publicClient } = client;
  return publicClient;
}
