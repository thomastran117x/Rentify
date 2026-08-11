import type { Request, RequestHandler } from "express";
import type { ClientDeviceContext } from "@/configuration/http/bindings";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { getHeader } from "@/configuration/http/request";

function isTrustedProxyHeaderEnabled(): boolean {
  const value = getOptionalEnvironmentVariable("TRUST_PROXY_HEADERS");
  return value === "1" || value?.toLowerCase() === "true";
}

function readProxyIpAddress(request: Request): string | undefined {
  const forwardedFor = getHeader(request, "x-forwarded-for");

  if (forwardedFor) {
    const [firstValue] = forwardedFor.split(",");
    const ip = firstValue?.trim();

    if (ip) {
      return ip;
    }
  }

  for (const headerName of [
    "cf-connecting-ip",
    "x-real-ip",
    "x-client-ip",
    "fly-client-ip",
    "fastly-client-ip",
    "true-client-ip",
  ]) {
    const value = getHeader(request, headerName)?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function readIpAddress(
  request: Request,
  remoteAddress?: string,
): string | undefined {
  if (isTrustedProxyHeaderEnabled()) {
    return readProxyIpAddress(request) ?? remoteAddress;
  }

  return remoteAddress;
}

/**
 * The peer address of the socket.
 *
 * Replaces `getConnInfo(c).remote.address` from @hono/node-server. Deliberately
 * reads the socket rather than `req.ip`, because `req.ip` would consult
 * Express's own `trust proxy` setting; proxy headers are handled by
 * {@link readProxyIpAddress} under our own TRUST_PROXY_HEADERS flag instead, so
 * the resolution order stays exactly as it was.
 */
function readRemoteAddress(request: Request): string | undefined {
  return request.socket?.remoteAddress ?? undefined;
}

function readPlatform(request: Request): string | undefined {
  const value =
    getHeader(request, "sec-ch-ua-platform") ??
    getHeader(request, "x-device-platform");

  if (!value) {
    return undefined;
  }

  return value.replaceAll('"', "").trim() || undefined;
}

function inferDeviceType(userAgent?: string): ClientDeviceContext["type"] {
  if (!userAgent) {
    return "unknown";
  }

  const normalized = userAgent.toLowerCase();

  if (
    /bot|crawler|spider|slurp|curl|wget|postmanruntime|insomnia/.test(
      normalized,
    )
  ) {
    return "bot";
  }

  if (/ipad|tablet|kindle|playbook|silk/.test(normalized)) {
    return "tablet";
  }

  if (/mobi|iphone|ipod|android.+mobile|windows phone/.test(normalized)) {
    return "mobile";
  }

  if (/macintosh|windows nt|linux x86_64|x11|cros/.test(normalized)) {
    return "desktop";
  }

  if (/android/.test(normalized)) {
    return "mobile";
  }

  return "unknown";
}

function readDevice(request: Request): ClientDeviceContext {
  const userAgent = getHeader(request, "user-agent")?.trim() || undefined;
  const inferredType = inferDeviceType(userAgent);
  const mobileHint = getHeader(request, "sec-ch-ua-mobile")?.trim();

  return {
    id: getHeader(request, "x-device-id")?.trim() || undefined,
    type: inferredType,
    isMobile: mobileHint === "?1" || inferredType === "mobile",
    userAgent,
    platform: readPlatform(request),
  };
}

export const clientContextMiddleware: RequestHandler = (
  request,
  _response,
  next,
) => {
  request.client = {
    ip: readIpAddress(request, readRemoteAddress(request)),
    device: readDevice(request),
  };

  next();
};
