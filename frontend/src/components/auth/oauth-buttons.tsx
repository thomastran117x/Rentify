"use client";

import { useState, type ReactNode } from "react";
import { publicEnv } from "@/lib/env";
import { authApi } from "@/lib/auth/api";
import type {
  OAuthAuthenticateResult,
  OAuthSignupRequiredResult,
  AuthResponseBody,
  LinkedOAuthProvidersResult,
} from "@/lib/auth/types";
import { isOAuthSignupRequired } from "@/lib/auth/types";
import { theme } from "@/styles/theme";

export type OAuthProvider = "google" | "microsoft" | "apple";
type RedirectOAuthProvider = Exclude<OAuthProvider, "apple">;

interface AuthOAuthButtonsProps {
  mode?: "authenticate" | "link";
  onSuccess?: (session: AuthResponseBody) => void;
  onLinked?: (result: LinkedOAuthProvidersResult) => void;
  onError: (message: string) => void;
  disabledProviders?: OAuthProvider[];
  onSignupRequired?: (result: OAuthSignupRequiredResult) => void;
}

interface PopupAuthResult {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

interface MicrosoftTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface ProviderInput {
  code?: string;
  codeVerifier?: string;
  idToken?: string;
  firstName?: string;
  lastName?: string;
}

interface ProviderSignInResult {
  input: ProviderInput;
  nonce: string;
}

interface AppleSignInResponse {
  authorization?: {
    code?: string;
    id_token?: string;
    state?: string;
  };
  user?: {
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
}

interface AppleIdAuth {
  init(config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    state: string;
    nonce: string;
    usePopup: boolean;
  }): void;
  signIn(): Promise<AppleSignInResponse>;
}

declare global {
  interface Window {
    AppleID?: { auth: AppleIdAuth };
  }
}

interface ProviderButtonConfig {
  provider: OAuthProvider;
  label: string;
  pendingLabel: string;
  enabled: boolean;
  icon: ReactNode;
}

const OAUTH_SCOPE = "openid email profile";
const APPLE_SDK_URL =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
const POPUP_CLOSED_MESSAGE =
  "The sign-in popup was closed before authentication finished.";
const STATE_MISMATCH_MESSAGE =
  "The sign-in response could not be verified. Please try again.";

let appleSdkPromise: Promise<AppleIdAuth> | null = null;

function createRandomString(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const encodedVerifier = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encodedVerifier);
  const bytes = new Uint8Array(digest);

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getPopupFeatures(): string {
  const width = 520;
  const height = 720;
  const left = Math.max(window.screenX + (window.outerWidth - width) / 2, 0);
  const top = Math.max(window.screenY + (window.outerHeight - height) / 2, 0);

  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
}

function parsePopupPayload(rawPayload: string): PopupAuthResult {
  const normalized =
    rawPayload.startsWith("#") || rawPayload.startsWith("?")
      ? rawPayload.slice(1)
      : rawPayload;
  const params = new URLSearchParams(normalized);

  return {
    code: params.get("code") ?? undefined,
    error: params.get("error") ?? undefined,
    errorDescription: params.get("error_description") ?? undefined,
    state: params.get("state") ?? undefined,
  };
}

function getProviderAuthorizeUrl(provider: RedirectOAuthProvider): string {
  if (provider === "google") {
    return "https://accounts.google.com/o/oauth2/v2/auth";
  }

  return `https://login.microsoftonline.com/${publicEnv.microsoftOAuthTenant}/oauth2/v2.0/authorize`;
}

function buildProviderParams(
  provider: RedirectOAuthProvider,
  state: string,
  nonce: string,
  redirectUri: string,
  codeChallenge: string,
): URLSearchParams {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    prompt: "select_account",
    nonce,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  if (provider === "google") {
    params.set("client_id", publicEnv.googleOAuthClientId);
    return params;
  }

  params.set("client_id", publicEnv.microsoftOAuthClientId);
  params.set("response_mode", "query");
  return params;
}

async function buildOAuthUrl(
  provider: RedirectOAuthProvider,
  state: string,
  nonce: string,
  codeVerifier: string,
): Promise<string> {
  const redirectUri = `${window.location.origin}/auth/${provider}`;
  const codeChallenge = await createPkceChallenge(codeVerifier);
  const params = buildProviderParams(
    provider,
    state,
    nonce,
    redirectUri,
    codeChallenge,
  );

  return `${getProviderAuthorizeUrl(provider)}?${params.toString()}`;
}

function getProviderDisplayName(provider: OAuthProvider): string {
  if (provider === "google") {
    return "Google";
  }

  return provider === "microsoft" ? "Microsoft" : "Apple";
}

function readProviderError(
  provider: OAuthProvider,
  payload: PopupAuthResult,
): string {
  if (payload.errorDescription) {
    return payload.errorDescription.replace(/\+/g, " ");
  }

  if (payload.error) {
    return `${getProviderDisplayName(provider)} sign-in failed: ${payload.error}.`;
  }

  return `${getProviderDisplayName(provider)} sign-in could not be completed.`;
}

async function exchangeMicrosoftCodeForIdToken(
  code: string,
  codeVerifier: string,
): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${publicEnv.microsoftOAuthTenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: publicEnv.microsoftOAuthClientId,
    redirect_uri: `${window.location.origin}/auth/microsoft`,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    scope: OAUTH_SCOPE,
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const payload = (await response.json()) as MicrosoftTokenResponse;

  if (!response.ok) {
    throw new Error(
      payload.error_description?.replace(/\+/g, " ") ||
        payload.error ||
        "Microsoft sign-in could not be completed.",
    );
  }

  if (!payload.id_token) {
    throw new Error("Microsoft token response did not include an ID token.");
  }

  return payload.id_token;
}

async function authenticateWithProvider(
  provider: OAuthProvider,
  input: ProviderInput,
  nonce: string,
): Promise<OAuthAuthenticateResult> {
  if (provider === "google") {
    return authApi.authenticateWithGoogle({
      code: input.code ?? "",
      codeVerifier: input.codeVerifier ?? "",
      nonce,
    });
  }

  if (provider === "apple") {
    return authApi.authenticateWithApple({ ...input, nonce });
  }

  return authApi.authenticateWithMicrosoft({
    idToken: input.idToken,
    code: input.code,
    codeVerifier: input.codeVerifier,
    nonce,
  });
}

async function linkWithProvider(
  provider: OAuthProvider,
  input: ProviderInput,
  nonce: string,
): Promise<LinkedOAuthProvidersResult> {
  if (provider === "google") {
    return authApi.linkOAuthProvider("google", {
      code: input.code ?? "",
      codeVerifier: input.codeVerifier ?? "",
      nonce,
    });
  }

  if (provider === "apple") {
    return authApi.linkOAuthProvider("apple", { ...input, nonce });
  }

  return authApi.linkOAuthProvider("microsoft", {
    idToken: input.idToken,
    code: input.code,
    codeVerifier: input.codeVerifier,
    nonce,
  });
}

async function openProviderPopup(
  provider: RedirectOAuthProvider,
): Promise<{ code: string; codeVerifier: string; nonce: string }> {
  const state = createRandomString();
  const nonce = createRandomString();
  const codeVerifier = createRandomString() + createRandomString();
  const popup = window.open(
    await buildOAuthUrl(provider, state, nonce, codeVerifier),
    `${provider}-oauth`,
    getPopupFeatures(),
  );

  if (!popup) {
    throw new Error(
      "Your browser blocked the sign-in popup. Please allow popups and try again.",
    );
  }

  return new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      finished = true;
      window.removeEventListener("message", handleMessage);
      clearInterval(closePoll);
    };

    const closePoll = window.setInterval(() => {
      if (popup.closed && !finished) {
        cleanup();
        reject(new Error(POPUP_CLOSED_MESSAGE));
      }
    }, 400);

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as
        | { source?: string; payload?: string }
        | undefined;

      if (
        data?.source !== "rentify-oauth-popup" ||
        typeof data.payload !== "string"
      ) {
        return;
      }

      const payload = parsePopupPayload(data.payload);

      if (payload.state !== state) {
        cleanup();
        popup.close();
        reject(new Error(STATE_MISMATCH_MESSAGE));
        return;
      }

      if (payload.error || !payload.code) {
        cleanup();
        popup.close();
        reject(new Error(readProviderError(provider, payload)));
        return;
      }

      cleanup();
      popup.close();
      resolve({
        code: payload.code,
        codeVerifier,
        nonce,
      });
    };

    window.addEventListener("message", handleMessage);
  });
}

async function signInWithRedirectProvider(
  provider: RedirectOAuthProvider,
): Promise<ProviderSignInResult> {
  const result = await openProviderPopup(provider);

  if (provider === "microsoft") {
    return {
      nonce: result.nonce,
      input: {
        idToken: await exchangeMicrosoftCodeForIdToken(
          result.code,
          result.codeVerifier,
        ),
      },
    };
  }

  return {
    nonce: result.nonce,
    input: { code: result.code, codeVerifier: result.codeVerifier },
  };
}

function loadAppleSdk(): Promise<AppleIdAuth> {
  if (window.AppleID?.auth) {
    return Promise.resolve(window.AppleID.auth);
  }

  appleSdkPromise ??= new Promise<AppleIdAuth>((resolve, reject) => {
    const script = document.createElement("script");

    const fail = () => {
      appleSdkPromise = null;
      script.remove();
      reject(new Error("Apple sign-in could not be loaded. Please try again."));
    };

    script.src = APPLE_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.AppleID?.auth) {
        resolve(window.AppleID.auth);
        return;
      }

      fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });

  return appleSdkPromise;
}

function readAppleSdkError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "error" in error
      ? String((error as { error: unknown }).error)
      : undefined;

  if (code === "popup_closed_by_user" || code === "user_cancelled_authorize") {
    return POPUP_CLOSED_MESSAGE;
  }

  return code
    ? `Apple sign-in failed: ${code}.`
    : "Apple sign-in could not be completed.";
}

// Apple's web flow posts its response cross-site, so its SDK popup is used
// instead of the redirect popup the other providers share.
async function signInWithApple(): Promise<ProviderSignInResult> {
  const state = createRandomString();
  const nonce = createRandomString();
  const appleAuth = await loadAppleSdk();

  appleAuth.init({
    clientId: publicEnv.appleOAuthClientId,
    scope: "name email",
    redirectURI: `${window.location.origin}/auth/apple`,
    state,
    nonce,
    usePopup: true,
  });

  let response: AppleSignInResponse;

  try {
    response = await appleAuth.signIn();
  } catch (error) {
    throw new Error(readAppleSdkError(error));
  }

  const { authorization, user } = response;

  if (authorization?.state !== state) {
    throw new Error(STATE_MISMATCH_MESSAGE);
  }

  if (!authorization.id_token) {
    throw new Error("Apple sign-in could not be completed.");
  }

  return {
    nonce,
    input: {
      idToken: authorization.id_token,
      firstName: user?.name?.firstName?.trim() || undefined,
      lastName: user?.name?.lastName?.trim() || undefined,
    },
  };
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.55-5.16 3.55-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.73-2.46 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.55.38-2.29V6.62H1.27A12 12 0 0 0 0 12c0 1.94.46 3.78 1.27 5.38l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.27 6.62l4 3.09c.95-2.85 3.6-4.96 6.73-4.96Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.37 1.43c0 1.14-.46 2.23-1.21 3.03-.8.86-2.1 1.52-3.17 1.44-.14-1.1.41-2.25 1.16-3.03.83-.87 2.24-1.5 3.22-1.44ZM20.5 17.23c-.56 1.29-.83 1.87-1.55 3.01-1.01 1.59-2.43 3.57-4.19 3.58-1.57.02-1.97-1.02-4.1-1.01-2.13.01-2.57 1.03-4.14 1.01-1.76-.02-3.11-1.8-4.12-3.39C-.44 15.99-.74 10.8 1.07 8.03 2.35 6.06 4.38 4.9 6.29 4.9c1.94 0 3.16 1.07 4.77 1.07 1.56 0 2.51-1.07 4.76-1.07 1.7 0 3.5.93 4.78 2.53-4.2 2.3-3.52 8.3.9 9.8Z"
      />
    </svg>
  );
}

interface OAuthProviderButtonProps {
  config: ProviderButtonConfig;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}

function OAuthProviderButton({
  config,
  pending,
  disabled,
  onClick,
}: OAuthProviderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={theme.auth.oauthButton}
    >
      <span className="flex min-w-0 items-center justify-center gap-3 text-center">
        {config.icon}
        <span>{pending ? config.pendingLabel : config.label}</span>
      </span>
    </button>
  );
}

export function AuthOAuthButtons({
  mode = "authenticate",
  onSuccess,
  onLinked,
  onError,
  disabledProviders = [],
  onSignupRequired,
}: AuthOAuthButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(
    null,
  );
  const isLinkMode = mode === "link";

  const providerConfigs = (
    [
      {
        provider: "google" as const,
        label: isLinkMode ? "Link Google" : "Continue with Google",
        pendingLabel: "Connecting to Google...",
        enabled:
          Boolean(publicEnv.googleOAuthClientId) &&
          !disabledProviders.includes("google"),
        icon: <GoogleIcon />,
      },
      {
        provider: "microsoft" as const,
        label: isLinkMode ? "Link Microsoft" : "Continue with Microsoft",
        pendingLabel: "Connecting to Microsoft...",
        enabled:
          Boolean(publicEnv.microsoftOAuthClientId) &&
          !disabledProviders.includes("microsoft"),
        icon: <MicrosoftIcon />,
      },
      {
        provider: "apple" as const,
        label: isLinkMode ? "Link Apple" : "Continue with Apple",
        pendingLabel: "Connecting to Apple...",
        enabled:
          Boolean(publicEnv.appleOAuthClientId) &&
          !disabledProviders.includes("apple"),
        icon: <AppleIcon />,
      },
    ] satisfies ProviderButtonConfig[]
  ).filter((provider) => provider.enabled);

  async function handleProviderClick(provider: OAuthProvider) {
    setPendingProvider(provider);
    onError("");

    try {
      const { input, nonce } =
        provider === "apple"
          ? await signInWithApple()
          : await signInWithRedirectProvider(provider);

      if (isLinkMode) {
        const linkedProviders = await linkWithProvider(provider, input, nonce);
        onLinked?.(linkedProviders);
        return;
      }

      const result = await authenticateWithProvider(provider, input, nonce);
      if (isOAuthSignupRequired(result)) {
        onSignupRequired?.(result);
        return;
      }
      onSuccess?.(result);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "OAuth sign-in could not be completed.",
      );
    } finally {
      setPendingProvider(null);
    }
  }

  if (!providerConfigs.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className={`w-full ${theme.auth.dividerLine}`} />
        </div>
        <div className="relative flex justify-center">
          <span
            className={`bg-white dark:bg-slate-900 px-3 ${theme.auth.dividerText}`}
          >
            {isLinkMode ? "Connect another provider" : "Or continue with"}
          </span>
        </div>
      </div>

      <div className="grid gap-3">
        {providerConfigs.map((config) => (
          <OAuthProviderButton
            key={config.provider}
            config={config}
            pending={pendingProvider === config.provider}
            disabled={pendingProvider !== null}
            onClick={() => void handleProviderClick(config.provider)}
          />
        ))}
      </div>
    </div>
  );
}
