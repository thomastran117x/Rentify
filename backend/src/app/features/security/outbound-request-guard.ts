import BadRequestError from "@/errors/http/bad-request.error";

interface OutboundRequestGuardOptions {
  allowedHosts?: string[];
  allowHttp?: boolean;
}

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/i,
  /^\[::1\]$/i,
  /^fc/i,
  /^fd/i,
];

export function assertTrustedOutboundUrl(
  value: string,
  options: OutboundRequestGuardOptions = {},
): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new BadRequestError("Outbound request URL is invalid.");
  }

  if (!options.allowHttp && url.protocol !== "https:") {
    throw new BadRequestError("Outbound request URL must use HTTPS.");
  }

  const hostname = url.hostname.trim().toLowerCase();
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "");

  if (!normalizedHostname) {
    throw new BadRequestError("Outbound request hostname is invalid.");
  }

  if (
    PRIVATE_HOSTNAME_PATTERNS.some((pattern) =>
      pattern.test(normalizedHostname),
    )
  ) {
    throw new BadRequestError("Outbound request host is not allowed.");
  }

  if (options.allowedHosts?.length) {
    const normalizedAllowedHosts = options.allowedHosts.map((host) =>
      host.trim().toLowerCase(),
    );

    if (!normalizedAllowedHosts.includes(hostname)) {
      throw new BadRequestError("Outbound request host is not allowed.");
    }
  }

  return url;
}
