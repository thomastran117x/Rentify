import {
  RAW_ENVIRONMENT_VARIABLE_NAMES,
  MINIMUM_TOKEN_SECRET_LENGTH,
} from "@/configuration/environment/constants";
import type {
  EnvironmentVariableName,
  NumberOptions,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

// Blob endpoints of the Azure public, China and US Government clouds, and the
// Azure DNS zone endpoints (<account>.z<nn>.blob.storage.azure.net). Account
// names are 3 to 24 lowercase letters and digits. A private endpoint is still
// addressed by one of these names; DNS sends it to the private address.
const STORAGE_ACCOUNT_HOST_PATTERNS = [
  /^([a-z0-9]{3,24})\.blob\.core\.(?:windows\.net|chinacloudapi\.cn|usgovcloudapi\.net)$/,
  /^([a-z0-9]{3,24})\.z[0-9]{2}\.blob\.storage\.azure\.net$/,
];

// Custom-subdomain endpoints of Azure AI services in the public, US Government
// and China clouds. Microsoft Entra ID only works against a custom subdomain.
const COGNITIVE_SERVICES_HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.cognitiveservices\.azure\.(?:com|us|cn)$/;

/**
 * Reads an Azure AI services endpoint, such as
 * https://<resource>.cognitiveservices.azure.com, into its origin. Returns
 * null for anything else, because every request to it carries an image and
 * either the API key or the process's bearer token.
 */
export function parseCognitiveServicesEndpoint(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !COGNITIVE_SERVICES_HOST_PATTERN.test(url.hostname)
  ) {
    return null;
  }

  return url.origin;
}

/**
 * Reads an Azure Blob service endpoint, https://<account>.blob.core.windows.net,
 * into the account name and the URL clients are built on. Returns null for
 * anything else. The host must be an Azure Blob endpoint, because in entra mode
 * every request to it carries the process's Azure Storage bearer token, which
 * another host could replay against the real account.
 */
export function parseStorageAccountUrl(
  value: string,
): { accountName: string; serviceUrl: string } | null {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    return null;
  }

  for (const pattern of STORAGE_ACCOUNT_HOST_PATTERNS) {
    const accountName = pattern.exec(url.hostname)?.[1];

    if (accountName) {
      return { accountName, serviceUrl: url.origin };
    }
  }

  return null;
}

/**
 * Reads a storage account connection string into the account name, its key,
 * and the blob endpoint clients are built on. Returns null when the string is
 * malformed or lacks AccountName or AccountKey.
 */
export function parseStorageConnectionString(
  value: string,
): { accountName: string; accountKey: string; serviceUrl: string } | null {
  const segments: Record<string, string> = {};

  for (const segment of value.split(";")) {
    const trimmed = segment.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      return null;
    }

    segments[trimmed.slice(0, separatorIndex)] = trimmed.slice(
      separatorIndex + 1,
    );
  }

  const accountName = segments.AccountName;
  const accountKey = segments.AccountKey;

  if (!accountName || !accountKey) {
    return null;
  }

  const protocol = segments.DefaultEndpointsProtocol ?? "https";
  const endpointSuffix = segments.EndpointSuffix ?? "core.windows.net";
  const serviceUrl =
    segments.BlobEndpoint ??
    `${protocol}://${accountName}.blob.${endpointSuffix}`;

  return {
    accountName,
    accountKey,
    serviceUrl: serviceUrl.replace(/\/+$/, ""),
  };
}

export function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function normalizeDelimitedList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function normalizeRawEnvironment(
  source: NodeJS.ProcessEnv,
): RawEnvironmentValues {
  const raw: RawEnvironmentValues = {};

  for (const name of RAW_ENVIRONMENT_VARIABLE_NAMES) {
    const value = normalizeOptionalString(source[name]);

    if (value !== undefined) {
      raw[name] = value;
    }
  }

  return raw;
}

export function parseNumber(
  raw: RawEnvironmentValues,
  name: EnvironmentVariableName,
  fallback: number,
  errors: string[],
  options: NumberOptions = {},
): number {
  const value = raw[name];

  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number(value);

  if (Number.isNaN(parsedValue)) {
    errors.push(`${name} must be a valid number.`);
    return fallback;
  }

  if (options.integer && !Number.isInteger(parsedValue)) {
    errors.push(`${name} must be an integer.`);
    return fallback;
  }

  if (options.min !== undefined && parsedValue < options.min) {
    errors.push(`${name} must be greater than or equal to ${options.min}.`);
    return fallback;
  }

  if (options.max !== undefined && parsedValue > options.max) {
    errors.push(`${name} must be less than or equal to ${options.max}.`);
    return fallback;
  }

  return parsedValue;
}

export function readRequiredString(
  raw: RawEnvironmentValues,
  name: EnvironmentVariableName,
  errors: string[],
): string {
  const value = raw[name];

  if (!value) {
    errors.push(`${name} is required.`);
    return "";
  }

  return value;
}

export function readRequiredSecret(
  raw: RawEnvironmentValues,
  name: EnvironmentVariableName,
  errors: string[],
): string {
  const value = readRequiredString(raw, name, errors);

  if (value && value.length < MINIMUM_TOKEN_SECRET_LENGTH) {
    errors.push(
      `${name} must be at least ${MINIMUM_TOKEN_SECRET_LENGTH} characters long.`,
    );
  }

  return value;
}
