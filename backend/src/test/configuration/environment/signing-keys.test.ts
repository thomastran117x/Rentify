import { generateKeyPairSync } from "node:crypto";
import {
  parseAccessTokenKeys,
  parseHmacKeys,
  rejectEqualSecrets,
} from "@/configuration/environment/domains/signing-keys";
import type { RawEnvironmentValues } from "@/configuration/environment/types";

const SECRET_A = "first-signing-secret-value-32-chars";
const SECRET_B = "second-signing-secret-value-32-char";

function rsaPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2_048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
}

function parseRefresh(raw: RawEnvironmentValues) {
  const errors: string[] = [];
  const keys = parseHmacKeys(raw, errors, {
    keysName: "REFRESH_TOKEN_KEYS",
    legacyName: "REFRESH_TOKEN_SECRET",
  });
  return { keys, errors };
}

function parseAccess(raw: RawEnvironmentValues) {
  const errors: string[] = [];
  const keys = parseAccessTokenKeys(raw, errors);
  return { keys, errors };
}

describe("parseHmacKeys", () => {
  it("maps the single-secret variable to the current key under kid default", () => {
    expect(parseRefresh({ REFRESH_TOKEN_SECRET: SECRET_A })).toEqual({
      keys: [{ kid: "default", status: "current", secret: SECRET_A }],
      errors: [],
    });
  });

  it("reads a JSON keyset", () => {
    const { keys, errors } = parseRefresh({
      REFRESH_TOKEN_KEYS: JSON.stringify([
        { kid: "2026-11", secret: SECRET_B, status: "current" },
        { kid: "default", secret: SECRET_A, status: "previous" },
      ]),
    });

    expect(errors).toEqual([]);
    expect(keys).toEqual([
      { kid: "2026-11", status: "current", secret: SECRET_B },
      { kid: "default", status: "previous", secret: SECRET_A },
    ]);
  });

  it("accepts a next key staged for promotion", () => {
    const { keys, errors } = parseRefresh({
      REFRESH_TOKEN_KEYS: JSON.stringify([
        { kid: "default", secret: SECRET_A, status: "current" },
        { kid: "2026-11", secret: SECRET_B, status: "next" },
      ]),
    });

    expect(errors).toEqual([]);
    expect(keys).toEqual([
      { kid: "default", status: "current", secret: SECRET_A },
      { kid: "2026-11", status: "next", secret: SECRET_B },
    ]);
  });

  it("reads a YAML keyset", () => {
    const { keys, errors } = parseRefresh({
      REFRESH_TOKEN_KEYS: [
        `- { kid: k2, secret: ${SECRET_B}, status: current }`,
        `- { kid: k1, secret: ${SECRET_A}, status: previous }`,
      ].join("\n"),
    });

    expect(errors).toEqual([]);
    expect(keys.map((key) => key.kid)).toEqual(["k2", "k1"]);
  });

  it("requires one of the two variables and refuses both", () => {
    expect(parseRefresh({}).errors).toEqual([
      "REFRESH_TOKEN_SECRET is required (or set REFRESH_TOKEN_KEYS).",
    ]);
    expect(
      parseRefresh({
        REFRESH_TOKEN_SECRET: SECRET_A,
        REFRESH_TOKEN_KEYS: "[]",
      }).errors,
    ).toEqual([
      "Set either REFRESH_TOKEN_KEYS or REFRESH_TOKEN_SECRET, not both.",
    ]);
  });

  it("rejects a short single secret", () => {
    expect(parseRefresh({ REFRESH_TOKEN_SECRET: "short" }).errors).toEqual([
      "REFRESH_TOKEN_SECRET must be at least 32 characters long.",
    ]);
  });

  it("rejects a keyset that is not a non-empty list", () => {
    expect(parseRefresh({ REFRESH_TOKEN_KEYS: "[" }).errors).toEqual([
      "REFRESH_TOKEN_KEYS must be a JSON or YAML list of keys.",
    ]);
    expect(parseRefresh({ REFRESH_TOKEN_KEYS: "[]" }).errors).toEqual([
      "REFRESH_TOKEN_KEYS must be a non-empty JSON or YAML list of keys.",
    ]);
    expect(parseRefresh({ REFRESH_TOKEN_KEYS: "kid: k1" }).errors).toEqual([
      "REFRESH_TOKEN_KEYS must be a non-empty JSON or YAML list of keys.",
    ]);
  });

  it("names the entry and field of a malformed key", () => {
    const { keys, errors } = parseRefresh({
      REFRESH_TOKEN_KEYS: JSON.stringify([
        { kid: "has.dot", secret: SECRET_A, status: "current" },
        { kid: "k2", secret: SECRET_B, status: "retired" },
        { kid: "k3", secret: SECRET_B, status: "previous", extra: true },
      ]),
    });

    expect(keys).toEqual([]);
    expect(errors).toEqual([
      "REFRESH_TOKEN_KEYS[0].kid: kid must be 1-64 letters, digits, '-' or '_'.",
      "REFRESH_TOKEN_KEYS[1].status: status must be 'current', 'next' or 'previous'.",
      expect.stringMatching(/^REFRESH_TOKEN_KEYS\[2\]: .*extra/),
    ]);
  });

  it("requires unique kids and exactly one current key", () => {
    expect(
      parseRefresh({
        REFRESH_TOKEN_KEYS: JSON.stringify([
          { kid: "k1", secret: SECRET_A, status: "current" },
          { kid: "k1", secret: SECRET_B, status: "current" },
        ]),
      }).errors,
    ).toEqual([
      "REFRESH_TOKEN_KEYS lists kid k1 more than once.",
      "REFRESH_TOKEN_KEYS must have exactly one current key; it has 2.",
    ]);
    expect(
      parseRefresh({
        REFRESH_TOKEN_KEYS: JSON.stringify([
          { kid: "k1", secret: SECRET_A, status: "previous" },
        ]),
      }).errors,
    ).toEqual([
      "REFRESH_TOKEN_KEYS must have exactly one current key; it has 0.",
    ]);
  });

  it("rejects missing, short, repeated, and asymmetric secrets without printing them", () => {
    const { publicKey } = rsaPair();
    const { errors } = parseRefresh({
      REFRESH_TOKEN_KEYS: JSON.stringify([
        { kid: "k1", secret: SECRET_A, status: "current" },
        { kid: "k2", secret: SECRET_A, status: "previous" },
        { kid: "k3", status: "previous" },
        { kid: "k4", secret: "short", status: "previous" },
        { kid: "k5", publicKey, status: "previous" },
      ]),
    });

    expect(errors).toEqual([
      "REFRESH_TOKEN_KEYS[k3] requires a secret.",
      "REFRESH_TOKEN_KEYS[k4] must be at least 32 characters long.",
      "REFRESH_TOKEN_KEYS[k5] must use a secret; REFRESH_TOKEN_KEYS is HMAC only.",
      "REFRESH_TOKEN_KEYS[k1] and REFRESH_TOKEN_KEYS[k2] must differ.",
    ]);
    expect(errors.join("\n")).not.toContain(SECRET_A);
  });
});

describe("parseAccessTokenKeys", () => {
  it("maps the legacy HS256 secret to kid default", () => {
    expect(parseAccess({ ACCESS_TOKEN_SECRET: SECRET_A })).toEqual({
      keys: [
        {
          kid: "default",
          status: "current",
          algorithm: "HS256",
          secret: SECRET_A,
        },
      ],
      errors: [],
    });
  });

  it("keeps the legacy algorithm and credential errors", () => {
    expect(parseAccess({ ACCESS_TOKEN_ALGORITHM: "ES256" }).errors).toEqual([
      "ACCESS_TOKEN_ALGORITHM must be 'HS256' or 'RS256'.",
      "ACCESS_TOKEN_SECRET is required when using HS256.",
    ]);
    expect(parseAccess({ ACCESS_TOKEN_SECRET: "short" }).errors).toEqual([
      "ACCESS_TOKEN_SECRET must be at least 32 characters long.",
    ]);
    expect(parseAccess({ ACCESS_TOKEN_ALGORITHM: "RS256" }).errors).toEqual([
      "ACCESS_TOKEN_PRIVATE_KEY is required when using RS256.",
      "ACCESS_TOKEN_PUBLIC_KEY is required when using RS256.",
    ]);
    expect(
      parseAccess({
        ACCESS_TOKEN_ALGORITHM: "RS256",
        ACCESS_TOKEN_PRIVATE_KEY: "not a key",
        ACCESS_TOKEN_PUBLIC_KEY: "not a key",
      }).errors,
    ).toEqual([
      "ACCESS_TOKEN_PRIVATE_KEY must contain a valid RSA private key.",
      "ACCESS_TOKEN_PUBLIC_KEY must contain a valid RSA public key.",
    ]);
  });

  it("derives each key's algorithm from its material", () => {
    const pair = rsaPair();
    const previousPair = rsaPair();
    const { keys, errors } = parseAccess({
      ACCESS_TOKEN_ALGORITHM: "HS256",
      ACCESS_TOKEN_KEYS: JSON.stringify([
        {
          kid: "rsa-2",
          status: "current",
          privateKey: pair.privateKey.replace(/\n/g, "\\n"),
          publicKey: pair.publicKey,
        },
        { kid: "rsa-1", status: "previous", publicKey: previousPair.publicKey },
        { kid: "default", status: "previous", secret: SECRET_A },
      ]),
    });

    expect(errors).toEqual([]);
    expect(keys).toEqual([
      {
        kid: "rsa-2",
        status: "current",
        algorithm: "RS256",
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
      },
      {
        kid: "rsa-1",
        status: "previous",
        algorithm: "RS256",
        publicKey: previousPair.publicKey,
      },
      {
        kid: "default",
        status: "previous",
        algorithm: "HS256",
        secret: SECRET_A,
      },
    ]);
  });

  it("refuses the keyset together with any single-key variable", () => {
    expect(
      parseAccess({
        ACCESS_TOKEN_SECRET: SECRET_A,
        ACCESS_TOKEN_KEYS: JSON.stringify([
          { kid: "k1", status: "current", secret: SECRET_B },
        ]),
      }).errors,
    ).toEqual([
      "Set either ACCESS_TOKEN_KEYS or ACCESS_TOKEN_SECRET / ACCESS_TOKEN_PRIVATE_KEY / ACCESS_TOKEN_PUBLIC_KEY, not both.",
    ]);
  });

  it("rejects keys that cannot sign or verify", () => {
    const pair = rsaPair();
    const otherPair = rsaPair();
    const { keys, errors } = parseAccess({
      ACCESS_TOKEN_KEYS: JSON.stringify([
        { kid: "current-public", status: "current", publicKey: pair.publicKey },
        {
          kid: "both",
          status: "previous",
          secret: SECRET_A,
          publicKey: pair.publicKey,
        },
        { kid: "empty", status: "previous" },
        { kid: "short", status: "previous", secret: "short" },
        { kid: "bad-public", status: "previous", publicKey: "not a key" },
        {
          kid: "mismatch",
          status: "previous",
          privateKey: pair.privateKey,
          publicKey: otherPair.publicKey,
        },
      ]),
    });

    expect(keys).toEqual([]);
    expect(errors).toEqual([
      "ACCESS_TOKEN_KEYS[current-public] is current, so it needs a privateKey to sign with.",
      "ACCESS_TOKEN_KEYS[both] must have either a secret (HS256) or an RSA key (RS256), not both.",
      "ACCESS_TOKEN_KEYS[empty] requires a secret (HS256) or a publicKey (RS256).",
      "ACCESS_TOKEN_KEYS[short] must be at least 32 characters long.",
      "ACCESS_TOKEN_KEYS[bad-public].publicKey must contain a valid RSA public key.",
      "ACCESS_TOKEN_KEYS[mismatch].privateKey and ACCESS_TOKEN_KEYS[mismatch].publicKey must form a matching RSA key pair.",
    ]);
  });

  it("rejects small and non-RSA keys", () => {
    const small = generateKeyPairSync("rsa", {
      modulusLength: 1_024,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const ec = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const { errors } = parseAccess({
      ACCESS_TOKEN_KEYS: JSON.stringify([
        { kid: "small", status: "current", ...small },
        { kid: "ec", status: "previous", ...ec },
      ]),
    });

    expect(errors).toEqual([
      "ACCESS_TOKEN_KEYS[small].privateKey must be at least 2048 bits.",
      "ACCESS_TOKEN_KEYS[small].publicKey must be at least 2048 bits.",
      "ACCESS_TOKEN_KEYS[ec].privateKey must contain an RSA private key.",
      "ACCESS_TOKEN_KEYS[ec].publicKey must contain an RSA public key.",
    ]);
  });

  it("rejects two HS256 keys that share a secret", () => {
    expect(
      parseAccess({
        ACCESS_TOKEN_KEYS: JSON.stringify([
          { kid: "k1", status: "current", secret: SECRET_A },
          { kid: "k2", status: "previous", secret: SECRET_A },
        ]),
      }).errors,
    ).toEqual(["ACCESS_TOKEN_KEYS[k1] and ACCESS_TOKEN_KEYS[k2] must differ."]);
  });
});

describe("rejectEqualSecrets", () => {
  it("reports every equal pair by label", () => {
    const errors: string[] = [];

    rejectEqualSecrets(
      [
        { label: "A", secret: SECRET_A },
        { label: "B", secret: SECRET_B },
        { label: "C", secret: SECRET_A },
      ],
      errors,
    );

    expect(errors).toEqual(["A and C must differ."]);
  });
});
