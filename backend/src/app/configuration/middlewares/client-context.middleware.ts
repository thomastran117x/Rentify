import { getConnInfo } from "@hono/node-server/conninfo";
import { createMiddleware } from "hono/factory";
import type {
  AppBindings,
  ClientDeviceContext,
} from "@/configuration/http/bindings";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";

function isTrustedProxyHeaderEnabled(): boolean {
  const value = getOptionalEnvironmentVariable("TRUST_PROXY_HEADERS");
  return value === "1" || value?.toLowerCase() === "true";
}

function readProxyIpAddress(headers: Headers): string | undefined {
  const forwardedFor = headers.get("x-forwarded-for");

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
    const value = headers.get(headerName)?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function readIpAddress(
  headers: Headers,
  remoteAddress?: string,
): string | undefined {
  if (isTrustedProxyHeaderEnabled()) {
    return readProxyIpAddress(headers) ?? remoteAddress;
  }

  return remoteAddress;
}

function readRemoteAddress(
  context: Parameters<typeof clientContextMiddleware>[0],
): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
}

function readPlatform(headers: Headers): string | undefined {
  const value =
    headers.get("sec-ch-ua-platform") ?? headers.get("x-device-platform");

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

function readDevice(headers: Headers): ClientDeviceContext {
  const userAgent = headers.get("user-agent")?.trim() || undefined;
  const inferredType = inferDeviceType(userAgent);
  const mobileHint = headers.get("sec-ch-ua-mobile")?.trim();

  return {
    id: headers.get("x-device-id")?.trim() || undefined,
    type: inferredType,
    isMobile: mobileHint === "?1" || inferredType === "mobile",
    userAgent,
    platform: readPlatform(headers),
  };
}

export const clientContextMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const headers = context.req.raw.headers;
    const remoteAddress = readRemoteAddress(context);

    context.set("client", {
      ip: readIpAddress(headers, remoteAddress),
      device: readDevice(headers),
    });

    await next();
  },
);
