import {
  describeProxyTrustWarnings,
  parseTrustedProxyCidr,
  resolveClientIp,
  type ProxyTrustConfig,
} from "@/configuration/http/client-ip";

function trust(overrides: Partial<ProxyTrustConfig> = {}): ProxyTrustConfig {
  return {
    trustedProxyHops: 0,
    trustedProxyCidrs: [],
    clientIpHeader: undefined,
    deprecatedTrustProxyHeaders: false,
    ...overrides,
  };
}

describe("resolveClientIp", () => {
  describe("with header trust disabled", () => {
    it("returns the socket peer and ignores every proxy header", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "203.0.113.9",
            clientIpHeaderValue: "198.51.100.7",
          },
          trust(),
        ),
      ).toBe("10.0.0.5");
    });

    it("returns undefined when the socket address is missing", () => {
      expect(
        resolveClientIp({ forwardedFor: "203.0.113.9" }, trust()),
      ).toBeUndefined();
    });
  });

  describe("with a hop count", () => {
    it("ignores a spoofed left-most entry and takes the address the proxy appended", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "203.0.113.9, 198.51.100.77",
          },
          trust({ trustedProxyHops: 1 }),
        ),
      ).toBe("198.51.100.77");
    });

    it("walks past each trusted proxy in a multi-proxy chain", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "203.0.113.9, 198.51.100.77, 10.0.1.4",
          },
          trust({ trustedProxyHops: 2 }),
        ),
      ).toBe("198.51.100.77");
    });

    it("clamps to the left-most entry when the hop count is larger than the chain", () => {
      expect(
        resolveClientIp(
          { remoteAddress: "10.0.0.5", forwardedFor: "198.51.100.77" },
          trust({ trustedProxyHops: 3 }),
        ),
      ).toBe("198.51.100.77");
    });

    it("falls back to the socket peer when no X-Forwarded-For arrived", () => {
      expect(
        resolveClientIp(
          { remoteAddress: "10.0.0.5" },
          trust({ trustedProxyHops: 1 }),
        ),
      ).toBe("10.0.0.5");
    });

    it("strips the port a proxy appends to an entry", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "203.0.113.9, 198.51.100.77:51234",
          },
          trust({ trustedProxyHops: 1 }),
        ),
      ).toBe("198.51.100.77");
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "[2001:db8::7]:443",
          },
          trust({ trustedProxyHops: 1 }),
        ),
      ).toBe("2001:db8::7");
    });

    it("never trusts an entry that is not an IP address", () => {
      expect(
        resolveClientIp(
          { remoteAddress: "10.0.0.5", forwardedFor: "198.51.100.77, unknown" },
          trust({ trustedProxyHops: 2 }),
        ),
      ).toBe("10.0.0.5");
    });

    it("returns undefined rather than reading headers when the socket address is missing", () => {
      expect(
        resolveClientIp(
          { forwardedFor: "198.51.100.77" },
          trust({ trustedProxyHops: 1 }),
        ),
      ).toBeUndefined();
    });

    it("passes an unparseable socket address through untouched", () => {
      expect(
        resolveClientIp(
          { remoteAddress: "not-an-ip", forwardedFor: "198.51.100.77" },
          trust({ trustedProxyHops: 1 }),
        ),
      ).toBe("not-an-ip");
    });
  });

  describe("with trusted proxy ranges", () => {
    const cidrs = ["10.0.0.0/8", "2001:db8:ffff::/48"];

    it("ignores proxy headers from a peer outside the trusted ranges", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "192.0.2.10",
            forwardedFor: "198.51.100.77",
            clientIpHeaderValue: "198.51.100.88",
          },
          trust({
            trustedProxyCidrs: cidrs,
            clientIpHeader: "cf-connecting-ip",
          }),
        ),
      ).toBe("192.0.2.10");
    });

    it("returns the first untrusted address walking from the right", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "203.0.113.9, 198.51.100.77, 10.0.1.4",
          },
          trust({ trustedProxyCidrs: cidrs }),
        ),
      ).toBe("198.51.100.77");
    });

    it("returns the left-most entry when every hop is a trusted proxy", () => {
      expect(
        resolveClientIp(
          { remoteAddress: "10.0.0.5", forwardedFor: "10.2.0.1, 10.0.1.4" },
          trust({ trustedProxyCidrs: cidrs }),
        ),
      ).toBe("10.2.0.1");
    });

    it("matches an IPv4-mapped socket peer against an IPv4 range", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "::ffff:10.0.0.5",
            forwardedFor: "203.0.113.9, 198.51.100.77",
          },
          trust({ trustedProxyCidrs: cidrs }),
        ),
      ).toBe("198.51.100.77");
    });

    it("walks IPv6 proxies and returns an IPv6 client", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "2001:db8:ffff::1",
            forwardedFor: "2001:db8:1::99, 2001:db8:ffff::2",
          },
          trust({ trustedProxyCidrs: cidrs }),
        ),
      ).toBe("2001:db8:1::99");
    });

    it("stops at the nearest trusted hop when an entry is not an IP address", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "198.51.100.77, garbage, 10.0.1.4",
          },
          trust({ trustedProxyCidrs: cidrs }),
        ),
      ).toBe("10.0.1.4");
    });
  });

  describe("with a configured client IP header", () => {
    it("uses the header when the peer is a trusted proxy", () => {
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "203.0.113.9, 198.51.100.77",
            clientIpHeaderValue: "198.51.100.88",
          },
          trust({
            trustedProxyCidrs: ["10.0.0.0/8"],
            clientIpHeader: "cf-connecting-ip",
          }),
        ),
      ).toBe("198.51.100.88");
    });

    it("falls back to the forwarded chain when the header is missing or invalid", () => {
      const config = trust({
        trustedProxyHops: 1,
        clientIpHeader: "cf-connecting-ip",
      });

      expect(
        resolveClientIp(
          { remoteAddress: "10.0.0.5", forwardedFor: "198.51.100.77" },
          config,
        ),
      ).toBe("198.51.100.77");
      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "198.51.100.77",
            clientIpHeaderValue: "not-an-ip",
          },
          config,
        ),
      ).toBe("198.51.100.77");
    });

    it("reads only the header, not X-Forwarded-For, when it is the sole setting", () => {
      const config = trust({ clientIpHeader: "cf-connecting-ip" });

      expect(
        resolveClientIp(
          {
            remoteAddress: "10.0.0.5",
            forwardedFor: "198.51.100.77",
            clientIpHeaderValue: "198.51.100.88",
          },
          config,
        ),
      ).toBe("198.51.100.88");
      expect(
        resolveClientIp(
          { remoteAddress: "10.0.0.5", forwardedFor: "198.51.100.77" },
          config,
        ),
      ).toBe("10.0.0.5");
    });
  });
});

describe("parseTrustedProxyCidr", () => {
  it.each([
    ["10.0.0.0/8", { address: "10.0.0.0", prefix: 8, family: "ipv4" }],
    ["192.0.2.1", { address: "192.0.2.1", prefix: 32, family: "ipv4" }],
    ["2001:db8::/32", { address: "2001:db8::", prefix: 32, family: "ipv6" }],
    ["::1", { address: "::1", prefix: 128, family: "ipv6" }],
  ])("parses %s", (value, expected) => {
    expect(parseTrustedProxyCidr(value)).toEqual(expected);
  });

  it.each([
    "10.0.0.0/33",
    "2001:db8::/129",
    "10.0.0.0/x",
    "proxy",
    "10.0.0.0/8/1",
  ])("rejects %s", (value) => {
    expect(parseTrustedProxyCidr(value)).toBeNull();
  });
});

describe("describeProxyTrustWarnings", () => {
  it("is silent for the defaults and for explicit settings", () => {
    expect(describeProxyTrustWarnings(trust())).toEqual([]);
    expect(
      describeProxyTrustWarnings(
        trust({ trustedProxyHops: 1, clientIpHeader: "cf-connecting-ip" }),
      ),
    ).toEqual([]);
  });

  it("warns when the deprecated alias supplies the hop count", () => {
    expect(
      describeProxyTrustWarnings(
        trust({ trustedProxyHops: 1, deprecatedTrustProxyHeaders: true }),
      ),
    ).toEqual([expect.stringContaining("TRUST_PROXY_HEADERS is deprecated")]);
  });

  it("warns when a client IP header has no hop count or range to bound it", () => {
    expect(
      describeProxyTrustWarnings(trust({ clientIpHeader: "cf-connecting-ip" })),
    ).toEqual([expect.stringContaining("CLIENT_IP_HEADER (cf-connecting-ip)")]);
    expect(
      describeProxyTrustWarnings(
        trust({
          trustedProxyHops: 1,
          deprecatedTrustProxyHeaders: true,
          clientIpHeader: "cf-connecting-ip",
        }),
      ),
    ).toHaveLength(2);
  });
});
