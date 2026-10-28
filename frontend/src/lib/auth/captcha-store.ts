"use client";

import { useSyncExternalStore } from "react";
import type { CaptchaAction } from "@/lib/auth/captcha-actions";

const CAPTCHA_STORAGE_KEY_PREFIX = "rentify.auth.captcha.";
const CAPTCHA_STORAGE_EVENT = "rentify-auth-captcha-storage";
const CAPTCHA_MAX_AGE_MS = 4 * 60 * 1000;

interface StoredCaptchaState {
  token: string;
  createdAt: number;
}

interface CachedCaptchaState {
  raw: string | null;
  parsed: StoredCaptchaState | null;
}

// Each action keeps its own token: the API rejects a token solved for one
// flow when it is spent on another.
const cachedCaptchaStates = new Map<CaptchaAction, CachedCaptchaState>();

export function getCaptchaStorageKey(action: CaptchaAction): string {
  return `${CAPTCHA_STORAGE_KEY_PREFIX}${action}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function emitCaptchaChange(): void {
  if (!canUseStorage()) {
    return;
  }

  window.dispatchEvent(new Event(CAPTCHA_STORAGE_EVENT));
}

function isCaptchaFresh(state: StoredCaptchaState): boolean {
  return Date.now() - state.createdAt < CAPTCHA_MAX_AGE_MS;
}

function forgetStoredCaptcha(action: CaptchaAction): void {
  window.sessionStorage.removeItem(getCaptchaStorageKey(action));
  cachedCaptchaStates.set(action, { raw: null, parsed: null });
}

function readStoredCaptchaState(
  action: CaptchaAction,
): StoredCaptchaState | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(getCaptchaStorageKey(action));
  const cached = cachedCaptchaStates.get(action);

  if (cached && rawValue === cached.raw) {
    if (cached.parsed && !isCaptchaFresh(cached.parsed)) {
      clearStoredCaptcha(action);
      return null;
    }

    return cached.parsed;
  }

  if (!rawValue) {
    cachedCaptchaStates.set(action, { raw: null, parsed: null });
    return null;
  }

  try {
    const parsedCaptcha = JSON.parse(rawValue) as StoredCaptchaState;

    if (!parsedCaptcha.token || !isCaptchaFresh(parsedCaptcha)) {
      forgetStoredCaptcha(action);
      return null;
    }

    cachedCaptchaStates.set(action, { raw: rawValue, parsed: parsedCaptcha });
    return parsedCaptcha;
  } catch {
    forgetStoredCaptcha(action);
    return null;
  }
}

function subscribeToCaptchaStore(onStoreChange: () => void): () => void {
  if (!canUseStorage()) {
    return () => undefined;
  }

  const handleChange = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(CAPTCHA_STORAGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(CAPTCHA_STORAGE_EVENT, handleChange);
  };
}

export function writeStoredCaptcha(action: CaptchaAction, token: string): void {
  if (!canUseStorage()) {
    return;
  }

  const nextState: StoredCaptchaState = {
    token,
    createdAt: Date.now(),
  };

  const serializedState = JSON.stringify(nextState);
  window.sessionStorage.setItem(getCaptchaStorageKey(action), serializedState);
  cachedCaptchaStates.set(action, { raw: serializedState, parsed: nextState });
  emitCaptchaChange();
}

export function clearStoredCaptcha(action: CaptchaAction): void {
  if (!canUseStorage()) {
    return;
  }

  forgetStoredCaptcha(action);
  emitCaptchaChange();
}

export function useAuthCaptchaToken(
  action: CaptchaAction,
): [string, (token: string) => void, () => void] {
  const token = useSyncExternalStore(
    subscribeToCaptchaStore,
    () => readStoredCaptchaState(action)?.token ?? "",
    () => "",
  );

  function setToken(nextToken: string): void {
    if (!nextToken.trim()) {
      clearStoredCaptcha(action);
      return;
    }

    writeStoredCaptcha(action, nextToken);
  }

  return [token, setToken, () => clearStoredCaptcha(action)];
}
