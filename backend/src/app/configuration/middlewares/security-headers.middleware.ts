import { createMiddleware } from "hono/factory";
import { environment } from "@/configuration/environment";
import type { AppBindings } from "@/configuration/http/bindings";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
};

const STRICT_TRANSPORT_SECURITY_HEADER = "strict-transport-security";
const STRICT_TRANSPORT_SECURITY_VALUE = "max-age=31536000; includeSubDomains";

export const securityHeadersMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    try {
      await next();
    } finally {
      for (const [headerName, headerValue] of Object.entries(
        SECURITY_HEADERS,
      )) {
        context.header(headerName, headerValue);
      }

      if (environment.isProduction()) {
        context.header(
          STRICT_TRANSPORT_SECURITY_HEADER,
          STRICT_TRANSPORT_SECURITY_VALUE,
        );
      }
    }
  },
);
