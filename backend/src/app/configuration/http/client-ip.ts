import { BlockList, isIP } from "node:net";
import type { AppEnvironment } from "@/configuration/environment/types";

export type ProxyTrustConfig = Pick<
  AppEnvironment["http"],
  | "trustedProxyHops"
  | "trustedProxyCidrs"
  | "clientIpHeader"
  | "deprecatedTrustProxyHeaders"
>;

export interface ClientIpSources {
  /** The socket peer: the closest hop, and the only address nobody can forge. */
  remoteAddress?: string;
  forwardedFor?: string;
  /** The value of the configured `clientIpHeader`, if the request carried it. */
  clientIpHeaderValue?: string;
}

export interface TrustedProxyCidr {
  address: string;
  prefix: number;
  family: "ipv4" | "ipv6";
}

const IPV4_MAPPED_PATTERN = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const BRACKETED_ADDRESS_PATTERN = /^\[([^\]]+)\](?::\d{1,5})?$/;
const IPV4_WITH_PORT_PATTERN = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;

const trustMatchers = new WeakMap<
  readonly string[],
  (address: string) => boolean
>();

function unmapIpv4(address: string): string {
  return IPV4_MAPPED_PATTERN.exec(address)?.[1] ?? address;
}

/**
 * Reads one hop as an IP address, or undefined when it is not one. Tolerates
 * the port some proxies (Azure Application Gateway, for one) append.
 */
function normalizeAddress(value: string): string | undefined {
  let candidate = value.trim();
  const bracketed = BRACKETED_ADDRESS_PATTERN.exec(candidate);

  if (bracketed) {
    candidate = bracketed[1];
  } else {
    candidate = IPV4_WITH_PORT_PATTERN.exec(candidate)?.[1] ?? candidate;
  }

  return isIP(candidate) ? candidate : undefined;
}

/**
 * Parses `10.0.0.0/8`, `2001:db8::/32`, or a bare address (a single host).
 * Returns null for anything else.
 */
export function parseTrustedProxyCidr(value: string): TrustedProxyCidr | null {
  const [address = "", prefixText, ...rest] = value.trim().split("/");
  const version = isIP(address);

  if (rest.length > 0 || version === 0) {
    return null;
  }

  const maxPrefix = version === 4 ? 32 : 128;
  const family = version === 4 ? "ipv4" : "ipv6";

  if (prefixText === undefined) {
    return { address, prefix: maxPrefix, family };
  }

  if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > maxPrefix) {
    return null;
  }

  return { address, prefix: Number(prefixText), family };
}

function getTrustMatcher(
  cidrs: readonly string[],
): (address: string) => boolean {
  const cached = trustMatchers.get(cidrs);

  if (cached) {
    return cached;
  }

  const blockList = new BlockList();

  for (const entry of cidrs) {
    const parsed = parseTrustedProxyCidr(entry);

    if (parsed) {
      blockList.addSubnet(parsed.address, parsed.prefix, parsed.family);
    }
  }

  const matcher = (address: string) => {
    const unmapped = unmapIpv4(address);
    return blockList.check(unmapped, isIP(unmapped) === 4 ? "ipv4" : "ipv6");
  };

  trustMatchers.set(cidrs, matcher);
  return matcher;
}

/**
 * Resolves the client address from the socket peer and the proxy headers.
 *
 * Proxies append to X-Forwarded-For, so only its right-hand end was written by
 * infrastructure we trust; everything to the left of that is whatever the
 * client sent. The chain `[...X-Forwarded-For, socket peer]` is therefore
 * walked from the right:
 *
 * - with `trustedProxyHops`, the client is that many hops in, clamped to the
 *   left-most entry when the chain is shorter;
 * - with `trustedProxyCidrs`, the client is the first address that is not a
 *   trusted proxy, or the left-most entry when every hop is trusted.
 *
 * A hop that is not an IP address is never trusted: the walk stops at the
 * nearest valid hop to its right. A vendor header is read only when it is the
 * configured `clientIpHeader` and the peer is a trusted proxy.
 */
export function resolveClientIp(
  sources: ClientIpSources,
  config: ProxyTrustConfig,
): string | undefined {
  const { remoteAddress } = sources;
  const hops = config.trustedProxyHops;
  const isTrusted =
    config.trustedProxyCidrs.length > 0
      ? getTrustMatcher(config.trustedProxyCidrs)
      : undefined;

  if (!remoteAddress || (hops === 0 && !isTrusted && !config.clientIpHeader)) {
    return remoteAddress;
  }

  const peer = normalizeAddress(remoteAddress);

  // A hop count cannot be checked against the peer, so it is taken on trust;
  // so is a header configured with no proxy settings at all, which startup
  // warns about.
  if (!peer || (isTrusted && !isTrusted(peer))) {
    return remoteAddress;
  }

  if (config.clientIpHeader && sources.clientIpHeaderValue) {
    const fromHeader = normalizeAddress(sources.clientIpHeaderValue);

    if (fromHeader) {
      return fromHeader;
    }
  }

  const forwarded = (sources.forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const steps = isTrusted ? forwarded.length : Math.min(hops, forwarded.length);
  let nearest = remoteAddress;

  for (let step = 1; step <= steps; step++) {
    const address = normalizeAddress(forwarded[forwarded.length - step]);

    if (!address) {
      return nearest;
    }

    if (isTrusted && !isTrusted(address)) {
      return address;
    }

    nearest = address;
  }

  return nearest;
}

/** Startup warnings for proxy settings that trust more than they can verify. */
export function describeProxyTrustWarnings(config: ProxyTrustConfig): string[] {
  const warnings: string[] = [];
  const hasExplicitTrust =
    !config.deprecatedTrustProxyHeaders &&
    (config.trustedProxyHops > 0 || config.trustedProxyCidrs.length > 0);

  if (config.deprecatedTrustProxyHeaders) {
    warnings.push(
      "TRUST_PROXY_HEADERS is deprecated and no TRUSTED_PROXY_HOPS or TRUSTED_PROXY_CIDRS is set, so one proxy hop is assumed. Set one of them explicitly.",
    );
  }

  if (config.clientIpHeader && !hasExplicitTrust) {
    warnings.push(
      `CLIENT_IP_HEADER (${config.clientIpHeader}) is set without TRUSTED_PROXY_HOPS or TRUSTED_PROXY_CIDRS, so it is believed whenever present. The edge must overwrite it on every request.`,
    );
  }

  return warnings;
}
