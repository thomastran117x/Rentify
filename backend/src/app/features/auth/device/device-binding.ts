import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { environment } from "@/configuration/environment";
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
const SIGNING_CONTEXT = "device-binding:v1:";

function getSecret(): string {
  return environment.getTokenConfig().deviceBindingSecret;
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNING_CONTEXT}${id}`)
    .digest("base64url");
}

/**
 * The cookie value for a binding id: the id and an HMAC over it. The id is
 * random and chosen here, never by the client, so knowing a device's id (from
 * a log, an email or the device list) is not enough to present it.
 */
export function signDeviceBindingId(id: string, secret = getSecret()): string {
  return `${id}.${sign(id, secret)}`;
}

export function createDeviceBindingId(): string {
  return randomBytes(ID_BYTES).toString("base64url");
}

/** The binding id a cookie value carries, or undefined if it does not verify. */
export function verifyDeviceBindingCookieValue(
  value: string | undefined,
  secret = getSecret(),
): string | undefined {
  if (!value) {
    return undefined;
  }

  const [id, signature, ...rest] = value.split(".");

  if (
    rest.length > 0 ||
    !id ||
    !signature ||
    !ID_PATTERN.test(id) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return undefined;
  }

  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? id
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
  const id = verifyDeviceBindingCookieValue(
    readCookie(request, getDeviceBindingCookieName()),
  );

  return id ? { id } : undefined;
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
