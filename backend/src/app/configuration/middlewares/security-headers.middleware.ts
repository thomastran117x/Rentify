import type { RequestHandler } from "express";
import { environment } from "@/configuration/environment";

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

export const securityHeadersMiddleware: RequestHandler = (
  _request,
  response,
  next,
) => {
  // Applied before next() rather than in a `finally` afterwards: headers must
  // be on the response before anything starts writing to it. These are static
  // values that no handler overrides, so the earlier application is equivalent.
  for (const [headerName, headerValue] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(headerName, headerValue);
  }

  if (environment.isProduction()) {
    response.setHeader(
      STRICT_TRANSPORT_SECURITY_HEADER,
      STRICT_TRANSPORT_SECURITY_VALUE,
    );
  }

  next();
};
