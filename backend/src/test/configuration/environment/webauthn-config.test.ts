import { buildWebAuthnConfig } from "@/configuration/environment/domains/webauthn";
import type {
  NodeEnvironment,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

function build(raw: RawEnvironmentValues, nodeEnv: NodeEnvironment = "test") {
  const errors: string[] = [];
  return { config: buildWebAuthnConfig(raw, errors, nodeEnv), errors };
}

describe("buildWebAuthnConfig", () => {
  it("derives the RP ID and origin from the local frontend by default", () => {
    expect(build({})).toEqual({
      config: {
        rpId: "localhost",
        rpName: "Rentify",
        origins: ["http://localhost:3040"],
      },
      errors: [],
    });
  });

  it("takes the RP ID from the first FRONTEND_URL origin", () => {
    const { config, errors } = build({
      FRONTEND_URL: "https://rentify.example/, https://app.rentify.example",
    });

    expect(errors).toEqual([]);
    expect(config).toMatchObject({
      rpId: "rentify.example",
      origins: ["https://rentify.example", "https://app.rentify.example"],
    });
  });

  it("accepts an explicit parent RP ID that covers every origin", () => {
    const { config, errors } = build({
      WEBAUTHN_RP_ID: " Rentify.Example ",
      WEBAUTHN_ORIGINS:
        "https://rentify.example,https://app.rentify.example,https://rentify.example",
      WEBAUTHN_RP_NAME: " Rentify Staging ",
    });

    expect(errors).toEqual([]);
    expect(config).toEqual({
      rpId: "rentify.example",
      rpName: "Rentify Staging",
      origins: ["https://rentify.example", "https://app.rentify.example"],
    });
  });

  it("prefers WEBAUTHN_ORIGINS over FRONTEND_URL", () => {
    const { config } = build({
      FRONTEND_URL: "http://localhost:3040",
      WEBAUTHN_ORIGINS: "https://rentify.example",
    });

    expect(config).toMatchObject({
      rpId: "rentify.example",
      origins: ["https://rentify.example"],
    });
  });

  it("rejects an origin that is not on the RP ID", () => {
    const { errors } = build({
      WEBAUTHN_RP_ID: "example.com",
      FRONTEND_URL: "http://localhost:3040",
    });

    expect(errors).toEqual([
      "FRONTEND_URL origin http://localhost:3040 is not on WEBAUTHN_RP_ID example.com or one of its subdomains.",
    ]);
  });

  it("does not treat a lookalike suffix as a subdomain", () => {
    const { errors } = build({
      WEBAUTHN_RP_ID: "rentify.example",
      WEBAUTHN_ORIGINS: "https://evilrentify.example",
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("is not on WEBAUTHN_RP_ID rentify.example");
  });

  it.each([
    ["an IP address", "127.0.0.1"],
    ["a scheme", "https://rentify.example"],
    ["a port", "localhost:3040"],
    ["a path", "rentify.example/app"],
  ])("rejects an RP ID with %s", (_label, rpId) => {
    const { errors } = build({
      WEBAUTHN_RP_ID: rpId,
      WEBAUTHN_ORIGINS: "https://rentify.example",
    });

    expect(errors).toEqual([
      expect.stringContaining("WEBAUTHN_RP_ID must be a domain name"),
    ]);
  });

  it("cannot derive an RP ID from an IP-address frontend", () => {
    const { errors } = build({ FRONTEND_URL: "http://127.0.0.1:3040" });

    expect(errors).toEqual([
      expect.stringContaining("not an IP address: 127.0.0.1"),
    ]);
  });

  it.each([
    ["a path", "https://rentify.example/app"],
    ["a query", "https://rentify.example/?a=1"],
    ["credentials", "https://user:pass@rentify.example"],
    ["another scheme", "ftp://rentify.example"],
    ["no scheme", "rentify.example"],
  ])("rejects an origin with %s", (_label, origin) => {
    const { errors } = build({
      WEBAUTHN_RP_ID: "rentify.example",
      WEBAUTHN_ORIGINS: origin,
    });

    expect(errors).toEqual([
      `WEBAUTHN_ORIGINS contains a value that is not a bare http(s) origin: ${origin}.`,
    ]);
  });

  it("requires at least one origin", () => {
    const { errors } = build({
      WEBAUTHN_RP_ID: "rentify.example",
      WEBAUTHN_ORIGINS: " , ",
    });

    expect(errors).toContain(
      "WEBAUTHN_ORIGINS must list at least one origin for passkeys.",
    );
  });

  it("requires https in production, except on localhost", () => {
    expect(
      build({ WEBAUTHN_ORIGINS: "http://rentify.example" }, "production")
        .errors,
    ).toEqual([
      "WEBAUTHN_ORIGINS origin http://rentify.example must use https in production.",
    ]);
    expect(
      build({ WEBAUTHN_ORIGINS: "https://rentify.example" }, "production")
        .errors,
    ).toEqual([]);
    expect(
      build({ FRONTEND_URL: "http://localhost:3040" }, "production").errors,
    ).toEqual([]);
  });

  it("allows http outside production", () => {
    expect(
      build({ WEBAUTHN_ORIGINS: "http://rentify.example" }, "development")
        .errors,
    ).toEqual([]);
  });
});
