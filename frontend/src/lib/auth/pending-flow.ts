"use client";

import { useSyncExternalStore } from "react";
import type { MfaVerificationChallengeFactor } from "@/lib/auth/mfa-verification-api";
import { safeNextPath } from "@/lib/auth/next-path";
import {
  LOGIN_MFA_FACTORS,
  type LoginMfaChallenge,
  type LoginMfaFactor,
} from "@/lib/auth/types";

const AUTH_PENDING_FLOW_STORAGE_KEY = "rentify.auth.pending-flow";
const AUTH_PENDING_FLOW_EVENT = "rentify-auth-pending-flow-storage";

export interface SignupVerificationPendingFlow {
  flow: "signup-verification";
  email: string;
  nextPath: string;
  alreadyPending: boolean;
}

export interface ForgotPasswordResetPendingFlow {
  flow: "forgot-password-reset";
  username: string;
}

export interface LoginUnlockPendingFlow {
  flow: "login-unlock";
  email: string;
}

export interface DeviceLoginMfaPendingFlow {
  flow: "device-login-mfa";
  nextPath: string;
  selectedFactor: MfaVerificationChallengeFactor;
  challengeSent: boolean;
}

/**
 * A sign-in waiting for its authenticator code. Kept so a refresh returns to
 * the code step; it holds the challenge token, never the password.
 */
export interface LoginMfaPendingFlow {
  flow: "login-mfa";
  mfaChallengeToken: string;
  availableFactors: LoginMfaFactor[];
  factor: LoginMfaFactor;
  /** How the first step signed in, which decides what happens after. */
  method: "password" | "oauth";
  expiresAt: string;
}

export type PersistedAuthPendingFlow =
  | SignupVerificationPendingFlow
  | ForgotPasswordResetPendingFlow
  | LoginUnlockPendingFlow
  | DeviceLoginMfaPendingFlow
  | LoginMfaPendingFlow;

function isLoginMfaFactor(value: unknown): value is LoginMfaFactor {
  return (LOGIN_MFA_FACTORS as readonly unknown[]).includes(value);
}

/**
 * Where to go afterwards is not stored: it comes from the sign-in page's
 * `next` parameter, which every entry to the code step keeps.
 */
export function createLoginMfaPendingFlow(
  challenge: LoginMfaChallenge,
  method: LoginMfaPendingFlow["method"],
  now = Date.now(),
): LoginMfaPendingFlow {
  const availableFactors = challenge.availableFactors.filter(isLoginMfaFactor);

  return {
    flow: "login-mfa",
    mfaChallengeToken: challenge.mfaChallengeToken,
    availableFactors,
    factor: availableFactors[0] ?? "totp",
    method,
    expiresAt: new Date(now + challenge.expiresInSeconds * 1000).toISOString(),
  };
}

let cachedRawPendingFlow: string | null | undefined;
let cachedParsedPendingFlow: PersistedAuthPendingFlow | null | undefined;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function emitPendingFlowChange(): void {
  if (!canUseStorage()) {
    return;
  }

  window.dispatchEvent(new Event(AUTH_PENDING_FLOW_EVENT));
}

function resetPendingFlowCache(): void {
  cachedRawPendingFlow = null;
  cachedParsedPendingFlow = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parsePendingFlow(
  value: unknown,
): PersistedAuthPendingFlow | null {
  if (!isRecord(value) || !isNonEmptyString(value.flow)) {
    return null;
  }

  switch (value.flow) {
    case "signup-verification":
      if (
        isNonEmptyString(value.email) &&
        isNonEmptyString(value.nextPath) &&
        typeof value.alreadyPending === "boolean"
      ) {
        return {
          flow: "signup-verification",
          email: value.email,
          nextPath: safeNextPath(value.nextPath),
          alreadyPending: value.alreadyPending,
        };
      }
      return null;

    case "forgot-password-reset":
      if (isNonEmptyString(value.username)) {
        return {
          flow: "forgot-password-reset",
          username: value.username,
        };
      }
      return null;

    case "login-unlock":
      if (isNonEmptyString(value.email)) {
        return {
          flow: "login-unlock",
          email: value.email,
        };
      }
      return null;

    case "device-login-mfa":
      if (
        isNonEmptyString(value.nextPath) &&
        (value.selectedFactor === "email" || value.selectedFactor === "totp") &&
        typeof value.challengeSent === "boolean"
      ) {
        return {
          flow: "device-login-mfa",
          nextPath: safeNextPath(value.nextPath),
          selectedFactor: value.selectedFactor,
          challengeSent: value.challengeSent,
        };
      }
      return null;

    case "login-mfa": {
      const availableFactors = Array.isArray(value.availableFactors)
        ? value.availableFactors.filter(isLoginMfaFactor)
        : [];

      if (
        isNonEmptyString(value.mfaChallengeToken) &&
        availableFactors.length > 0 &&
        isLoginMfaFactor(value.factor) &&
        availableFactors.includes(value.factor) &&
        (value.method === "password" || value.method === "oauth") &&
        isNonEmptyString(value.expiresAt) &&
        !Number.isNaN(Date.parse(value.expiresAt))
      ) {
        return {
          flow: "login-mfa",
          mfaChallengeToken: value.mfaChallengeToken,
          availableFactors,
          factor: value.factor,
          method: value.method,
          expiresAt: value.expiresAt,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

export function readPersistedAuthPendingFlow(): PersistedAuthPendingFlow | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(AUTH_PENDING_FLOW_STORAGE_KEY);

  if (
    rawValue === cachedRawPendingFlow &&
    cachedParsedPendingFlow !== undefined
  ) {
    return cachedParsedPendingFlow;
  }

  if (!rawValue) {
    resetPendingFlowCache();
    return null;
  }

  try {
    const parsedValue = parsePendingFlow(JSON.parse(rawValue));

    if (!parsedValue) {
      window.sessionStorage.removeItem(AUTH_PENDING_FLOW_STORAGE_KEY);
      resetPendingFlowCache();
      return null;
    }

    cachedRawPendingFlow = rawValue;
    cachedParsedPendingFlow = parsedValue;
    return parsedValue;
  } catch {
    window.sessionStorage.removeItem(AUTH_PENDING_FLOW_STORAGE_KEY);
    resetPendingFlowCache();
    return null;
  }
}

export function writePersistedAuthPendingFlow(
  flow: PersistedAuthPendingFlow,
): void {
  if (!canUseStorage()) {
    return;
  }

  const serializedFlow = JSON.stringify(flow);
  const currentSerializedFlow = window.sessionStorage.getItem(
    AUTH_PENDING_FLOW_STORAGE_KEY,
  );

  if (currentSerializedFlow === serializedFlow) {
    return;
  }

  window.sessionStorage.setItem(AUTH_PENDING_FLOW_STORAGE_KEY, serializedFlow);
  cachedRawPendingFlow = serializedFlow;
  cachedParsedPendingFlow = flow;
  emitPendingFlowChange();
}

export function clearPersistedAuthPendingFlow(): void {
  if (!canUseStorage()) {
    return;
  }

  window.sessionStorage.removeItem(AUTH_PENDING_FLOW_STORAGE_KEY);
  resetPendingFlowCache();
  emitPendingFlowChange();
}

export function clearPersistedAuthPendingFlowByType(
  flowType: PersistedAuthPendingFlow["flow"],
): void {
  const currentFlow = readPersistedAuthPendingFlow();

  if (currentFlow?.flow !== flowType) {
    return;
  }

  clearPersistedAuthPendingFlow();
}

export function getPersistedAuthPendingFlowSnapshot():
  | PersistedAuthPendingFlow
  | null
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return readPersistedAuthPendingFlow();
}

export function subscribeToPersistedAuthPendingFlow(
  onStoreChange: () => void,
): () => void {
  if (!canUseStorage()) {
    return () => undefined;
  }

  const handleChange = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(AUTH_PENDING_FLOW_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(AUTH_PENDING_FLOW_EVENT, handleChange);
  };
}

export function usePersistedAuthPendingFlow():
  | PersistedAuthPendingFlow
  | null
  | undefined {
  return useSyncExternalStore(
    subscribeToPersistedAuthPendingFlow,
    getPersistedAuthPendingFlowSnapshot,
    () => undefined,
  );
}
