import BadRequestError from "@/errors/http/bad-request.error";
import { assertTrustedOutboundUrl } from "@/features/security/outbound-request-guard";

describe("assertTrustedOutboundUrl", () => {
  it("returns parsed https urls for allowed public hosts", () => {
    const url = assertTrustedOutboundUrl("https://api.rent.example/path?q=1", {
      allowedHosts: ["api.rent.example", "cdn.rent.example"],
    });

    expect(url.hostname).toBe("api.rent.example");
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/path");
  });

  it("rejects malformed urls and non-https protocols by default", () => {
    expect(() => assertTrustedOutboundUrl("not-a-url")).toThrow(
      BadRequestError,
    );
    expect(() => assertTrustedOutboundUrl("http://rent.example")).toThrow(
      "Outbound request URL must use HTTPS.",
    );
  });

  it("allows http only when explicitly enabled", () => {
    const url = assertTrustedOutboundUrl("http://rent.example/resource", {
      allowHttp: true,
    });

    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("rent.example");
  });

  it("rejects private and loopback hosts", () => {
    for (const host of [
      "https://localhost/resource",
      "https://127.0.0.1/resource",
      "https://10.0.0.1/resource",
      "https://192.168.1.1/resource",
      "https://169.254.1.1/resource",
      "https://0.0.0.1/resource",
      "https://[::1]/resource",
      "https://[fc00::1]/resource",
      "https://[fd00::1]/resource",
    ]) {
      expect(() => assertTrustedOutboundUrl(host)).toThrow(
        "Outbound request host is not allowed.",
      );
    }
  });

  it("normalizes allowed hosts before matching", () => {
    expect(() =>
      assertTrustedOutboundUrl("https://api.rent.example/path", {
        allowedHosts: ["  CDN.RENT.EXAMPLE  "],
      }),
    ).toThrow("Outbound request host is not allowed.");

    const url = assertTrustedOutboundUrl("https://api.rent.example/path", {
      allowedHosts: ["  API.RENT.EXAMPLE  "],
    });

    expect(url.hostname).toBe("api.rent.example");
  });
});
