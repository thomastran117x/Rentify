"use client";

import { useSyncExternalStore } from "react";
import type { MfaVerificationChallengeFactor } from "@/lib/auth/mfa-verification-api";

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

export type PersistedAuthPendingFlow =
  | SignupVerificationPendingFlow
  | ForgotPasswordResetPendingFlow
  | LoginUnlockPendingFlow
  | DeviceLoginMfaPendingFlow;

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

function parsePendingFlow(value: unknown): PersistedAuthPendingFlow | null {
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
          nextPath: value.nextPath,
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
          nextPath: value.nextPath,
          selectedFactor: value.selectedFactor,
          challengeSent: value.challengeSent,
        };
      }
      return null;

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
