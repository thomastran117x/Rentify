import { buildHttpConfig } from "@/configuration/environment/domains/core";
import type { RawEnvironmentValues } from "@/configuration/environment/types";

function build(raw: RawEnvironmentValues) {
  const errors: string[] = [];
  return { config: buildHttpConfig(raw, errors), errors };
}

describe("buildHttpConfig proxy trust", () => {
  it("trusts no proxy headers by default", () => {
    const { config, errors } = build({});

    expect(config).toMatchObject({
      trustedProxyHops: 0,
      trustedProxyCidrs: [],
      clientIpHeader: undefined,
      deprecatedTrustProxyHeaders: false,
    });
    expect(errors).toEqual([]);
  });

  it("parses an explicit hop count, proxy ranges, and a client IP header", () => {
    expect(build({ TRUSTED_PROXY_HOPS: "2" }).config.trustedProxyHops).toBe(2);

    const { config, errors } = build({
      TRUSTED_PROXY_CIDRS: " 10.0.0.0/8, 2001:db8::/32 ,192.0.2.1",
      CLIENT_IP_HEADER: " CF-Connecting-IP ",
    });

    expect(config.trustedProxyCidrs).toEqual([
      "10.0.0.0/8",
      "2001:db8::/32",
      "192.0.2.1",
    ]);
    expect(config.clientIpHeader).toBe("cf-connecting-ip");
    expect(errors).toEqual([]);
  });

  it("maps the deprecated TRUST_PROXY_HEADERS flag to one hop", () => {
    const { config, errors } = build({
      TRUST_PROXY_HEADERS: "true",
      TRUSTED_PROXY_HOPS: "0",
    });

    expect(config.trustedProxyHops).toBe(1);
    expect(config.deprecatedTrustProxyHeaders).toBe(true);
    expect(errors).toEqual([]);
  });

  it("lets explicit settings take precedence over the deprecated flag", () => {
    expect(
      build({ TRUST_PROXY_HEADERS: "true", TRUSTED_PROXY_HOPS: "2" }).config,
    ).toMatchObject({
      trustedProxyHops: 2,
      deprecatedTrustProxyHeaders: false,
    });
    expect(
      build({ TRUST_PROXY_HEADERS: "true", TRUSTED_PROXY_CIDRS: "10.0.0.0/8" })
        .config,
    ).toMatchObject({
      trustedProxyHops: 0,
      deprecatedTrustProxyHeaders: false,
    });
  });

  it("rejects a negative or fractional hop count", () => {
    expect(build({ TRUSTED_PROXY_HOPS: "-1" }).errors).toEqual([
      "TRUSTED_PROXY_HOPS must be greater than or equal to 0.",
    ]);
    expect(build({ TRUSTED_PROXY_HOPS: "1.5" }).errors).toEqual([
      "TRUSTED_PROXY_HOPS must be an integer.",
    ]);
  });

  it("rejects invalid proxy ranges", () => {
    expect(
      build({ TRUSTED_PROXY_CIDRS: "10.0.0.0/8,10.0.0.0/40,proxy.internal" })
        .errors,
    ).toEqual([
      "TRUSTED_PROXY_CIDRS contains invalid addresses or ranges: 10.0.0.0/40, proxy.internal.",
    ]);
  });

  it("rejects a hop count and proxy ranges together", () => {
    expect(
      build({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_CIDRS: "10.0.0.0/8" })
        .errors,
    ).toEqual([
      "Set either TRUSTED_PROXY_HOPS or TRUSTED_PROXY_CIDRS, not both.",
    ]);
  });

  it("rejects a malformed client IP header and X-Forwarded-For", () => {
    const malformed = build({ CLIENT_IP_HEADER: "cf connecting ip" });
    const forwarded = build({ CLIENT_IP_HEADER: "X-Forwarded-For" });

    expect(malformed.config.clientIpHeader).toBeUndefined();
    expect(malformed.errors).toEqual([
      "CLIENT_IP_HEADER must be a single HTTP header name.",
    ]);
    expect(forwarded.config.clientIpHeader).toBeUndefined();
    expect(forwarded.errors).toEqual([
      expect.stringContaining("CLIENT_IP_HEADER cannot be x-forwarded-for"),
    ]);
  });
});
