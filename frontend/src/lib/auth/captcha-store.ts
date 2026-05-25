"use client";

import { useSyncExternalStore } from "react";

const CAPTCHA_STORAGE_KEY = "rentify.auth.captcha";
const CAPTCHA_STORAGE_EVENT = "rentify-auth-captcha-storage";
const CAPTCHA_MAX_AGE_MS = 4 * 60 * 1000;

interface StoredCaptchaState {
  token: string;
  createdAt: number;
}

let cachedRawCaptcha: string | null | undefined;
let cachedParsedCaptcha: StoredCaptchaState | null | undefined;

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

function readStoredCaptchaState(): StoredCaptchaState | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(CAPTCHA_STORAGE_KEY);

  if (rawValue === cachedRawCaptcha && cachedParsedCaptcha !== undefined) {
    if (cachedParsedCaptcha && !isCaptchaFresh(cachedParsedCaptcha)) {
      clearStoredCaptcha();
      return null;
    }

    return cachedParsedCaptcha;
  }

  if (!rawValue) {
    cachedRawCaptcha = null;
    cachedParsedCaptcha = null;
    return null;
  }

  try {
    const parsedCaptcha = JSON.parse(rawValue) as StoredCaptchaState;

    if (!parsedCaptcha.token || !isCaptchaFresh(parsedCaptcha)) {
      window.sessionStorage.removeItem(CAPTCHA_STORAGE_KEY);
      cachedRawCaptcha = null;
      cachedParsedCaptcha = null;
      return null;
    }

    cachedRawCaptcha = rawValue;
    cachedParsedCaptcha = parsedCaptcha;
    return parsedCaptcha;
  } catch {
    window.sessionStorage.removeItem(CAPTCHA_STORAGE_KEY);
    cachedRawCaptcha = null;
    cachedParsedCaptcha = null;
    return null;
  }
}

function getStoredCaptchaToken(): string {
  return readStoredCaptchaState()?.token ?? "";
}

function getCaptchaSnapshot(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return getStoredCaptchaToken();
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

export function writeStoredCaptcha(token: string): void {
  if (!canUseStorage()) {
    return;
  }

  const nextState: StoredCaptchaState = {
    token,
    createdAt: Date.now(),
  };

  const serializedState = JSON.stringify(nextState);
  window.sessionStorage.setItem(CAPTCHA_STORAGE_KEY, serializedState);
  cachedRawCaptcha = serializedState;
  cachedParsedCaptcha = nextState;
  emitCaptchaChange();
}

export function clearStoredCaptcha(): void {
  if (!canUseStorage()) {
    return;
  }

  window.sessionStorage.removeItem(CAPTCHA_STORAGE_KEY);
  cachedRawCaptcha = null;
  cachedParsedCaptcha = null;
  emitCaptchaChange();
}

export function useAuthCaptchaToken(): [
  string,
  (token: string) => void,
  () => void,
] {
  const token = useSyncExternalStore(
    subscribeToCaptchaStore,
    getCaptchaSnapshot,
    () => "",
  );

  function setToken(nextToken: string): void {
    if (!nextToken.trim()) {
      clearStoredCaptcha();
      return;
    }

    writeStoredCaptcha(nextToken);
  }

  return [token, setToken, clearStoredCaptcha];
}
