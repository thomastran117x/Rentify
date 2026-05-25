import {
  RAW_ENVIRONMENT_VARIABLE_NAMES,
  MINIMUM_TOKEN_SECRET_LENGTH,
} from "@/configuration/environment/constants";
import type {
  EnvironmentVariableName,
  NumberOptions,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

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
