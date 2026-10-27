import type { Request, RequestHandler } from "express";
import type { ClientDeviceContext } from "@/configuration/http/bindings";
import { environment } from "@/configuration/environment";
import { resolveClientIp } from "@/configuration/http/client-ip";
import { resolveClientSource } from "@/configuration/http/client-source";
import { getHeader } from "@/configuration/http/request";

/**
 * The socket peer: the closest hop, and the only address nobody can forge.
 *
 * Deliberately reads the socket rather than `req.ip`, because `req.ip` would
 * consult Express's own `trust proxy` setting; proxy headers are handled by
 * {@link resolveClientIp} under our own `http.trustedProxy*` settings instead.
 */
function readRemoteAddress(request: Request): string | undefined {
  return request.socket?.remoteAddress ?? undefined;
}

function readIpAddress(request: Request): string | undefined {
  const config = environment.getHttpConfig();

  return resolveClientIp(
    {
      remoteAddress: readRemoteAddress(request),
      forwardedFor: getHeader(request, "x-forwarded-for"),
      clientIpHeaderValue: config.clientIpHeader
        ? getHeader(request, config.clientIpHeader)
        : undefined,
    },
    config,
  );
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
    ip: readIpAddress(request),
    device: readDevice(request),
    ...resolveClientSource(request),
  };

  next();
};
