const DEVICE_STORAGE_KEY = "rentify.auth.device-id";

function createDeviceId(): string {
  const webCrypto = globalThis.crypto;

  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function getDeviceId(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const existingDeviceId = window.localStorage
    .getItem(DEVICE_STORAGE_KEY)
    ?.trim();

  if (existingDeviceId) {
    return existingDeviceId;
  }

  const nextDeviceId = createDeviceId();
  window.localStorage.setItem(DEVICE_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

export function getDevicePlatform(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  return userAgentData?.platform || navigator.platform || undefined;
}
