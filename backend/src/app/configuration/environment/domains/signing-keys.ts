import { createPrivateKey, createPublicKey } from "node:crypto";
import yaml from "js-yaml";
import { z } from "zod";
import { DEFAULT_SIGNING_KEY_ID } from "@/configuration/environment/constants";
import {
  hasMinimumSecretLength,
  readRequiredSecret,
} from "@/configuration/environment/shared";
import type {
  AccessTokenAlgorithm,
  AccessTokenSigningKey,
  AppEnvironment,
  EnvironmentVariableName,
  HmacSigningKey,
  NodeEnvironment,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

// No dots, so a kid can sit between the dots of a refresh-token envelope.
const SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const signingKeyEntrySchema = z
  .object({
    kid: z
      .string()
      .regex(
        SIGNING_KEY_ID_PATTERN,
        "kid must be 1-64 letters, digits, '-' or '_'.",
      ),
    status: z.enum(["current", "next", "previous"], {
      error: "status must be 'current', 'next' or 'previous'.",
    }),
    secret: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional(),
    publicKey: z.string().min(1).optional(),
  })
  .strict();

type SigningKeyEntry = z.infer<typeof signingKeyEntrySchema>;

/** A keyset variable and the single-secret variable it replaces. */
export interface KeysetNames {
  keysName: EnvironmentVariableName;
  legacyName: EnvironmentVariableName;
}

const ACCESS_TOKEN_KEYSET: KeysetNames = {
  keysName: "ACCESS_TOKEN_KEYS",
  legacyName: "ACCESS_TOKEN_SECRET",
};
export const REFRESH_TOKEN_KEYSET: KeysetNames = {
  keysName: "REFRESH_TOKEN_KEYS",
  legacyName: "REFRESH_TOKEN_SECRET",
};
export const PERSONAL_ACCESS_TOKEN_KEYSET: KeysetNames = {
  keysName: "PERSONAL_ACCESS_TOKEN_KEYS",
  legacyName: "PERSONAL_ACCESS_TOKEN_SECRET",
};

/** A secret named for error messages, which never carry the value itself. */
export interface LabelledSecret {
  label: string;
  secret: string;
  /** Compared ignoring case, as a hex-encoded key is. */
  caseInsensitive?: boolean;
  /**
   * Secrets of one group are not compared with each other, because the
   * group's own parser already has.
   */
  group?: number;
}

export function normalizePem(value?: string): string | undefined {
  return value?.replace(/\\n/g, "\n");
}

function validateRsaKeys(
  keys: {
    privateKeyPem?: string;
    publicKeyPem: string;
    privateKeyLabel: string;
    publicKeyLabel: string;
  },
  errors: string[],
): void {
  const { privateKeyLabel, publicKeyLabel } = keys;
  let privateKey: ReturnType<typeof createPrivateKey> | undefined;
  let publicKey: ReturnType<typeof createPublicKey> | undefined;

  if (keys.privateKeyPem) {
    try {
      privateKey = createPrivateKey(keys.privateKeyPem);
      if (privateKey.asymmetricKeyType !== "rsa") {
        errors.push(`${privateKeyLabel} must contain an RSA private key.`);
        privateKey = undefined;
      } else if (
        (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048
      ) {
        errors.push(`${privateKeyLabel} must be at least 2048 bits.`);
        privateKey = undefined;
      }
    } catch {
      errors.push(`${privateKeyLabel} must contain a valid RSA private key.`);
    }
  }

  try {
    publicKey = createPublicKey(keys.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "rsa") {
      errors.push(`${publicKeyLabel} must contain an RSA public key.`);
      publicKey = undefined;
    } else if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048) {
      errors.push(`${publicKeyLabel} must be at least 2048 bits.`);
      publicKey = undefined;
    }
  } catch {
    errors.push(`${publicKeyLabel} must contain a valid RSA public key.`);
  }

  if (!privateKey || !publicKey) {
    return;
  }

  const derivedPublicKey = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  const configuredPublicKey = publicKey.export({
    format: "der",
    type: "spki",
  });

  if (!derivedPublicKey.equals(configuredPublicKey)) {
    errors.push(
      `${privateKeyLabel} and ${publicKeyLabel} must form a matching RSA key pair.`,
    );
  }
}

function secretsAreEqual(left: LabelledSecret, right: LabelledSecret): boolean {
  return left.caseInsensitive || right.caseInsensitive
    ? left.secret.toLowerCase() === right.secret.toLowerCase()
    : left.secret === right.secret;
}

/** Pushes an error for every pair of equal secrets not in the same group. */
export function rejectEqualSecrets(
  secrets: LabelledSecret[],
  errors: string[],
): void {
  secrets.forEach((left, index) => {
    for (const right of secrets.slice(index + 1)) {
      const sameGroup = left.group !== undefined && left.group === right.group;

      if (!sameGroup && secretsAreEqual(left, right)) {
        errors.push(`${left.label} and ${right.label} must differ.`);
      }
    }
  });
}

/** Names a key by the variable it came from, never by its value. */
function keyLabel(
  raw: RawEnvironmentValues,
  names: KeysetNames,
  kid: string,
): string {
  return raw[names.keysName] ? `${names.keysName}[${kid}]` : names.legacyName;
}

function labelledSecrets(
  raw: RawEnvironmentValues,
  keys: HmacSigningKey[],
  names: KeysetNames,
): LabelledSecret[] {
  return keys.map((key) => ({
    label: keyLabel(raw, names, key.kid),
    secret: key.secret,
  }));
}

/**
 * Reads a keyset variable: a JSON or YAML list of
 * `{ kid, status, secret | privateKey/publicKey }`. Every kid is unique and
 * exactly one key is current.
 */
function readKeysetEntries(
  value: string,
  name: EnvironmentVariableName,
  errors: string[],
): SigningKeyEntry[] {
  let document: unknown;

  try {
    document = yaml.load(value);
  } catch {
    errors.push(`${name} must be a JSON or YAML list of keys.`);
    return [];
  }

  if (!Array.isArray(document) || document.length === 0) {
    errors.push(`${name} must be a non-empty JSON or YAML list of keys.`);
    return [];
  }

  const entries: SigningKeyEntry[] = [];
  let hasInvalidEntry = false;

  document.forEach((entry: unknown, index) => {
    const result = signingKeyEntrySchema.safeParse(entry);

    if (!result.success) {
      hasInvalidEntry = true;
      for (const issue of result.error.issues) {
        const path = issue.path.length ? `.${issue.path.join(".")}` : "";
        errors.push(`${name}[${index}]${path}: ${issue.message}`);
      }
      return;
    }

    entries.push(result.data);
  });

  if (hasInvalidEntry) {
    return [];
  }

  const kids = new Set<string>();
  for (const entry of entries) {
    if (kids.has(entry.kid)) {
      errors.push(`${name} lists kid ${entry.kid} more than once.`);
    }
    kids.add(entry.kid);
  }

  const currentCount = entries.filter(
    (entry) => entry.status === "current",
  ).length;
  if (currentCount !== 1) {
    errors.push(
      `${name} must have exactly one current key; it has ${currentCount}.`,
    );
  }

  return entries;
}

/**
 * The keys for an HMAC purpose (refresh tokens, PAT hashes). Without the
 * keyset variable, the single-secret variable becomes the current key under
 * kid `default`.
 */
export function parseHmacKeys(
  raw: RawEnvironmentValues,
  errors: string[],
  names: KeysetNames,
): HmacSigningKey[] {
  const { keysName, legacyName } = names;
  const keysValue = raw[keysName];

  if (keysValue && raw[legacyName]) {
    errors.push(`Set either ${keysName} or ${legacyName}, not both.`);
    return [];
  }

  if (!keysValue) {
    const errorCount = errors.length;
    const secret = readRequiredSecret(raw, legacyName, errors, keysName);

    return errors.length > errorCount
      ? []
      : [{ kid: DEFAULT_SIGNING_KEY_ID, status: "current", secret }];
  }

  const keys: HmacSigningKey[] = [];

  for (const entry of readKeysetEntries(keysValue, keysName, errors)) {
    const label = keyLabel(raw, names, entry.kid);

    if (entry.privateKey || entry.publicKey) {
      errors.push(`${label} must use a secret; ${keysName} is HMAC only.`);
    } else if (!entry.secret) {
      errors.push(`${label} requires a secret.`);
    } else if (hasMinimumSecretLength(label, entry.secret, errors)) {
      keys.push({ kid: entry.kid, status: entry.status, secret: entry.secret });
    }
  }

  rejectEqualSecrets(labelledSecrets(raw, keys, names), errors);

  return keys;
}

/** The algorithm new access tokens are signed with. */
function readAccessTokenAlgorithm(
  raw: RawEnvironmentValues,
  errors: string[],
): AccessTokenAlgorithm {
  const configuredAlgorithm = raw.ACCESS_TOKEN_ALGORITHM ?? "HS256";

  if (configuredAlgorithm !== "HS256" && configuredAlgorithm !== "RS256") {
    errors.push("ACCESS_TOKEN_ALGORITHM must be 'HS256' or 'RS256'.");
  }

  return configuredAlgorithm === "RS256" ? "RS256" : "HS256";
}

function parseLegacyAccessTokenKey(
  raw: RawEnvironmentValues,
  errors: string[],
): AccessTokenSigningKey[] {
  const algorithm = readAccessTokenAlgorithm(raw, errors);

  if (algorithm === "HS256") {
    const secret = raw.ACCESS_TOKEN_SECRET;

    if (!secret) {
      errors.push("ACCESS_TOKEN_SECRET is required when using HS256.");
      return [];
    }
    if (!hasMinimumSecretLength("ACCESS_TOKEN_SECRET", secret, errors)) {
      return [];
    }

    return [
      {
        kid: DEFAULT_SIGNING_KEY_ID,
        status: "current",
        algorithm,
        secret,
      },
    ];
  }

  const privateKey = normalizePem(raw.ACCESS_TOKEN_PRIVATE_KEY);
  const publicKey = normalizePem(raw.ACCESS_TOKEN_PUBLIC_KEY);

  if (!privateKey) {
    errors.push("ACCESS_TOKEN_PRIVATE_KEY is required when using RS256.");
  }
  if (!publicKey) {
    errors.push("ACCESS_TOKEN_PUBLIC_KEY is required when using RS256.");
  }
  if (!privateKey || !publicKey) {
    return [];
  }

  const errorCount = errors.length;
  validateRsaKeys(
    {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      privateKeyLabel: "ACCESS_TOKEN_PRIVATE_KEY",
      publicKeyLabel: "ACCESS_TOKEN_PUBLIC_KEY",
    },
    errors,
  );
  if (errors.length > errorCount) {
    return [];
  }

  return [
    {
      kid: DEFAULT_SIGNING_KEY_ID,
      status: "current",
      algorithm,
      privateKey,
      publicKey,
    },
  ];
}

/**
 * A keyset entry with a secret is an HS256 key, and one with an RSA key is an
 * RS256 key, so moving between algorithms is an ordinary rotation.
 */
function toAccessTokenKey(
  entry: SigningKeyEntry,
  label: string,
  errors: string[],
): AccessTokenSigningKey | undefined {
  const privateKey = normalizePem(entry.privateKey);
  const publicKey = normalizePem(entry.publicKey);

  if (entry.secret) {
    if (privateKey || publicKey) {
      errors.push(
        `${label} must have either a secret (HS256) or an RSA key (RS256), not both.`,
      );
      return undefined;
    }
    if (!hasMinimumSecretLength(label, entry.secret, errors)) {
      return undefined;
    }

    return {
      kid: entry.kid,
      status: entry.status,
      algorithm: "HS256",
      secret: entry.secret,
    };
  }

  if (!publicKey) {
    errors.push(`${label} requires a secret (HS256) or a publicKey (RS256).`);
    return undefined;
  }
  if (entry.status === "current" && !privateKey) {
    errors.push(`${label} is current, so it needs a privateKey to sign with.`);
    return undefined;
  }

  const errorCount = errors.length;
  validateRsaKeys(
    {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      privateKeyLabel: `${label}.privateKey`,
      publicKeyLabel: `${label}.publicKey`,
    },
    errors,
  );
  if (errors.length > errorCount) {
    return undefined;
  }

  return {
    kid: entry.kid,
    status: entry.status,
    algorithm: "RS256",
    publicKey,
    ...(privateKey ? { privateKey } : {}),
  };
}

export function parseAccessTokenKeys(
  raw: RawEnvironmentValues,
  errors: string[],
): AccessTokenSigningKey[] {
  const keysValue = raw.ACCESS_TOKEN_KEYS;

  if (!keysValue) {
    return parseLegacyAccessTokenKey(raw, errors);
  }

  if (
    raw.ACCESS_TOKEN_SECRET ||
    raw.ACCESS_TOKEN_PRIVATE_KEY ||
    raw.ACCESS_TOKEN_PUBLIC_KEY
  ) {
    errors.push(
      "Set either ACCESS_TOKEN_KEYS or ACCESS_TOKEN_SECRET / ACCESS_TOKEN_PRIVATE_KEY / ACCESS_TOKEN_PUBLIC_KEY, not both.",
    );
    return [];
  }

  const algorithm = readAccessTokenAlgorithm(raw, errors);
  const keys: AccessTokenSigningKey[] = [];

  for (const entry of readKeysetEntries(
    keysValue,
    "ACCESS_TOKEN_KEYS",
    errors,
  )) {
    const key = toAccessTokenKey(
      entry,
      keyLabel(raw, ACCESS_TOKEN_KEYSET, entry.kid),
      errors,
    );
    if (key) {
      keys.push(key);
    }
  }

  // A key's material decides its algorithm, so without this check a secret
  // in the current slot would quietly turn an RS256 deployment into HS256.
  const current = keys.find((key) => key.status === "current");
  if (current && current.algorithm !== algorithm) {
    errors.push(
      `${keyLabel(raw, ACCESS_TOKEN_KEYSET, current.kid)} is the current key but is an ${current.algorithm} key, and ACCESS_TOKEN_ALGORITHM is ${algorithm}. Promote an ${algorithm} key or change ACCESS_TOKEN_ALGORITHM.`,
    );
  }

  rejectEqualSecrets(accessTokenHmacSecrets(raw, keys), errors);

  return keys;
}

function accessTokenHmacSecrets(
  raw: RawEnvironmentValues,
  keys: AccessTokenSigningKey[],
): LabelledSecret[] {
  return labelledSecrets(
    raw,
    keys.flatMap((key) => (key.algorithm === "HS256" ? [key] : [])),
    ACCESS_TOKEN_KEYSET,
  );
}

/**
 * Production must scope its JWTs to an issuer and audience, and must not use
 * one secret for two purposes, where a leak of one would compromise both.
 */
export function validateProductionTokenSigning(
  raw: RawEnvironmentValues,
  auth: AppEnvironment["auth"],
  nodeEnv: NodeEnvironment,
  errors: string[],
): void {
  if (nodeEnv !== "production") {
    return;
  }

  if (!auth.issuer) {
    errors.push("TOKEN_ISSUER (auth.issuer) is required in production.");
  }
  if (!auth.audience) {
    errors.push("TOKEN_AUDIENCE (auth.audience) is required in production.");
  }

  // Each keyset already rejected equal secrets within itself.
  rejectEqualSecrets(
    [
      accessTokenHmacSecrets(raw, auth.accessTokenKeys),
      labelledSecrets(raw, auth.refreshTokenKeys, REFRESH_TOKEN_KEYSET),
      labelledSecrets(
        raw,
        auth.personalAccessTokenKeys,
        PERSONAL_ACCESS_TOKEN_KEYSET,
      ),
      [
        {
          label: "AUTH_AUDIT_IDENTIFIER_SECRET",
          secret: auth.authAuditIdentifierSecret,
        },
      ],
      [{ label: "OTP_HASH_SECRET", secret: auth.otpHashSecret }],
      [{ label: "DEVICE_BINDING_SECRET", secret: auth.deviceBindingSecret }],
      [
        {
          label: "MFA_TOTP_ENCRYPTION_KEY",
          secret: auth.mfaTotpEncryptionKey,
          caseInsensitive: true,
        },
      ],
    ].flatMap((secrets, group) =>
      // A missing secret is reported elsewhere and is not a duplicate.
      secrets
        .filter((entry) => entry.secret)
        .map((entry) => ({ ...entry, group })),
    ),
    errors,
  );
}
