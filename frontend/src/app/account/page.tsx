"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  KeyRound,
  Lock,
  Monitor,
  Phone,
  Shield,
  Unlink,
  User,
} from "lucide-react";
import {
  AuthOAuthButtons,
  type OAuthProvider,
} from "@/components/auth/oauth-buttons";
import { useAuth } from "@/components/auth/auth-context";
import { MfaVerificationDialog } from "@/components/auth/mfa-verification-dialog";
import { HomeMfaTotpPanel } from "@/components/home/home-mfa-totp-panel";
import { HomePasswordPanel } from "@/components/home/home-password-panel";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  ApiClientError,
  type KnownDeviceRecord,
  type LinkedOAuthProvidersResult,
  type OAuthProvider as LinkedOAuthProvider,
  type PersonalAccessTokenSummary,
} from "@/lib/auth/types";
import { normalizeUsername, validateUsernameFormat } from "@/lib/auth/username";
import { useUsernameAvailability } from "@/lib/auth/use-username-availability";
import { UsernameAvailabilityHint } from "@/components/auth/username-availability-hint";
import { FieldErrorMessage } from "@/components/errors";
import {
  mfaVerificationApi,
  type MfaVerificationOptionsResult,
} from "@/lib/auth/mfa-verification-api";
import { profilesApi, type ProfileRecord } from "@/lib/profiles/api";

const providerLabels: Record<LinkedOAuthProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

export function formatLinkedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Date only — the cooldown is measured in days, so an exact time is noise. */
export function formatCooldownDate(value?: string): string {
  if (!value) {
    return "soon";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * The rename cooldown is a 429, and `getApiErrorMessage` collapses every 429
 * into generic rate-limit copy. Branch on the code first so the user is told
 * what actually happened and when they can retry.
 */
export function getProfileSaveErrorMessage(error: unknown): string {
  if (
    error instanceof ApiClientError &&
    error.code === "USERNAME_CHANGE_COOLDOWN"
  ) {
    const details = error.details as { availableAt?: string } | undefined;

    return `You can only change your username once every 30 days. You can change it again on ${formatCooldownDate(details?.availableAt)}.`;
  }

  return getApiErrorMessage(error, {
    action: "save your profile",
    // Surfaces the backend's own 409 text for a taken username, which the
    // generic fallback used to swallow.
    preserveClientMessage: true,
    fallback: "We couldn't save your profile right now. Please try again.",
  });
}

export function deviceLabel(device: KnownDeviceRecord): string {
  if (device.label) return device.label;
  const parts = [device.type, device.platform].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Unknown device";
}

export default function AccountPage() {
  const { status, session } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState<
    "profile" | "security" | "developer"
  >("profile");

  // Security tab MFA gate
  const [securityUnlocked, setSecurityUnlocked] = useState(false);
  const [securityChecking, setSecurityChecking] = useState(false);
  const [verificationDialogOptions, setVerificationDialogOptions] =
    useState<MfaVerificationOptionsResult | null>(null);
  const verificationResolverRef = useRef<((value: boolean) => void) | null>(
    null,
  );

  // Profile tab state
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileIsPrivate, setProfileIsPrivate] = useState(false);
  const [profilePersonalization, setProfilePersonalization] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [profilePending, setProfilePending] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileMessageTone, setProfileMessageTone] = useState<
    "success" | "error"
  >("success");
  const [profileUsernameError, setProfileUsernameError] = useState<
    string | undefined
  >(undefined);
  const usernameLocked = profile ? !profile.canChangeUsername : false;
  const usernameAvailability = useUsernameAvailability(profileUsername, {
    currentUsername: profile?.username,
    enabled: !usernameLocked,
  });

  // Security — password (managed by HomePasswordPanel internally)

  // Security — OAuth providers
  const [providers, setProviders] = useState<LinkedOAuthProvidersResult | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pendingUnlink, setPendingUnlink] =
    useState<LinkedOAuthProvider | null>(null);

  // Security — phone number (SMS)
  const [profilePhone, setProfilePhone] = useState("");
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [phonePending, setPhonePending] = useState(false);

  // Security — registered devices
  const [devices, setDevices] = useState<KnownDeviceRecord[]>([]);
  const [devicesMessage, setDevicesMessage] = useState<string | null>(null);
  const [pendingDeviceRemove, setPendingDeviceRemove] = useState<string | null>(
    null,
  );
  const [confirmDeviceRemove, setConfirmDeviceRemove] = useState<string | null>(
    null,
  );

  // Security — disable account
  const [disableMessage, setDisableMessage] = useState<string | null>(null);
  const [disablePending, setDisablePending] = useState(false);
  const [disableConfirm, setDisableConfirm] = useState(false);

  // Developer tab state
  const [personalAccessTokens, setPersonalAccessTokens] = useState<
    PersonalAccessTokenSummary[]
  >([]);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("Rentify MCP");
  const [tokenExpiryDays, setTokenExpiryDays] = useState("30");
  const [tokenAccessLevel, setTokenAccessLevel] = useState<"read" | "write">(
    "read",
  );
  const [pendingTokenCreate, setPendingTokenCreate] = useState(false);
  const [pendingTokenRevoke, setPendingTokenRevoke] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    authApi
      .linkedOAuthProviders()
      .then((result) => {
        if (active) setProviders(result);
      })
      .catch((error) => {
        if (active) {
          setMessage(
            getApiErrorMessage(error, {
              action: "load your connected providers",
              fallback:
                "We couldn't load your connected providers right now. Please try again.",
            }),
          );
        }
      });

    authApi
      .listPersonalAccessTokens()
      .then((result) => {
        if (active) setPersonalAccessTokens(result.tokens);
      })
      .catch((error) => {
        if (active) {
          setTokenMessage(
            getApiErrorMessage(error, {
              action: "load your personal access tokens",
              fallback:
                "We couldn't load your personal access tokens right now. Please try again.",
            }),
          );
        }
      });

    profilesApi
      .getMine()
      .then((result) => {
        if (active) {
          setProfile(result);
          setProfileUsername(result.username);
          setProfilePhone(result.phoneNumber ?? "");
          setProfileIsPrivate(result.isPrivate);
          setProfilePersonalization(
            result.recommendationPersonalizationEnabled,
          );
        }
      })
      .catch((error) => {
        if (active) {
          setProfileMessage(
            getApiErrorMessage(error, {
              action: "load your profile",
              fallback:
                "We couldn't load your profile right now. Please try again.",
            }),
          );
        }
      });

    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    if (!securityUnlocked) return;

    let active = true;

    authApi
      .listKnownDevices()
      .then((result) => {
        if (active) setDevices(result.devices);
      })
      .catch((error) => {
        if (active) {
          setDevicesMessage(
            getApiErrorMessage(error, {
              action: "load your registered devices",
              fallback:
                "We couldn't load your registered devices right now. Please try again.",
            }),
          );
        }
      });

    return () => {
      active = false;
    };
  }, [securityUnlocked]);

  const linkedProviderNames = useMemo(
    () =>
      new Set(providers?.providers.map((provider) => provider.provider) ?? []),
    [providers],
  );

  const canUnlinkProvider = Boolean(
    providers && (providers.hasPassword || providers.providers.length > 1),
  );

  async function handleUnlink(provider: LinkedOAuthProvider) {
    setPendingUnlink(provider);
    setMessage(null);

    try {
      const result = await authApi.unlinkOAuthProvider(provider);
      setProviders(result);
      setMessage(`${providerLabels[provider]} was unlinked.`);
    } catch (error) {
      setMessage(
        getApiErrorMessage(error, {
          action: `unlink ${providerLabels[provider]}`,
          fallback:
            "We couldn't unlink that provider right now. Please try again.",
        }),
      );
    } finally {
      setPendingUnlink(null);
    }
  }

  async function handleSaveProfile() {
    const formatError = validateUsernameFormat(profileUsername);
    const takenError =
      usernameAvailability.status === "taken"
        ? "That username is already taken."
        : undefined;
    const usernameError = formatError ?? takenError;

    setProfileUsernameError(usernameError);

    if (usernameError) {
      return;
    }

    setProfilePending(true);
    setProfileMessage(null);

    try {
      const result = await profilesApi.updateMine({
        username: normalizeUsername(profileUsername),
        isPrivate: profileIsPrivate,
        recommendationPersonalizationEnabled: profilePersonalization,
      });
      setProfile(result);
      setProfileUsername(result.username);
      setProfileIsPrivate(result.isPrivate);
      setProfilePersonalization(result.recommendationPersonalizationEnabled);
      setProfileMessageTone("success");
      setProfileMessage("Profile saved.");
    } catch (error) {
      setProfileMessageTone("error");
      setProfileMessage(getProfileSaveErrorMessage(error));
    } finally {
      setProfilePending(false);
    }
  }

  async function activateSecurityTab() {
    setActiveTab("security");
    if (securityUnlocked) return;

    setSecurityChecking(true);
    try {
      const options = await mfaVerificationApi.getOptions("mfa-management");
      if (options.verified) {
        setSecurityUnlocked(true);
      }
    } catch {
      // Gate will show naturally
    } finally {
      setSecurityChecking(false);
    }
  }

  async function handleVerifyIdentity() {
    let options: MfaVerificationOptionsResult;
    try {
      options = await mfaVerificationApi.getOptions("mfa-management");
    } catch {
      return;
    }

    const verified = await new Promise<boolean>((resolve) => {
      verificationResolverRef.current = resolve;
      setVerificationDialogOptions(options);
    });

    setVerificationDialogOptions(null);
    if (verified) {
      setSecurityUnlocked(true);
    }
  }

  async function handleSavePhone() {
    if (!profile) return;

    setPhonePending(true);
    setPhoneMessage(null);

    try {
      const result = await profilesApi.updateMine({
        username: profile.username,
        phoneNumber: profilePhone.trim() || null,
      });
      setProfile(result);
      setProfilePhone(result.phoneNumber ?? "");
      setPhoneMessage("Phone number saved.");
    } catch (error) {
      setPhoneMessage(
        getApiErrorMessage(error, {
          action: "save your phone number",
          fallback:
            "We couldn't save your phone number right now. Please try again.",
        }),
      );
    } finally {
      setPhonePending(false);
    }
  }

  async function handleRemoveDevice(deviceId: string) {
    setPendingDeviceRemove(deviceId);
    setDevicesMessage(null);

    try {
      await authApi.removeKnownDevice(deviceId);
      setDevices((current) => current.filter((d) => d.deviceId !== deviceId));
      setDevicesMessage("Device removed.");
    } catch (error) {
      setDevicesMessage(
        getApiErrorMessage(error, {
          action: "remove that device",
          fallback:
            "We couldn't remove that device right now. Please try again.",
        }),
      );
    } finally {
      setPendingDeviceRemove(null);
    }
  }

  function handleDisableAccount() {
    setDisablePending(true);
    setDisableMessage(
      "Account deactivation is not yet available. Please contact support if you need to close your account.",
    );
    setDisablePending(false);
  }

  async function handleCreatePersonalAccessToken() {
    const normalizedName = tokenName.trim();

    if (!normalizedName) {
      setTokenMessage("Token name is required.");
      return;
    }

    setPendingTokenCreate(true);
    setTokenMessage(null);
    setCreatedToken(null);

    try {
      const result = await authApi.createPersonalAccessToken({
        name: normalizedName,
        expiresInDays: Number(tokenExpiryDays),
        scopes:
          tokenAccessLevel === "write"
            ? ["mcp:read", "mcp:write"]
            : ["mcp:read"],
      });
      setPersonalAccessTokens((current) => [result, ...current]);
      setCreatedToken(result.token);
      setTokenMessage(
        "Personal access token created. This value is only shown once.",
      );
    } catch (error) {
      setTokenMessage(
        getApiErrorMessage(error, {
          action: "create a personal access token",
          fallback:
            "We couldn't create that personal access token right now. Please try again.",
        }),
      );
    } finally {
      setPendingTokenCreate(false);
    }
  }

  async function handleRevokePersonalAccessToken(tokenId: string) {
    setPendingTokenRevoke(tokenId);
    setTokenMessage(null);
    setCreatedToken(null);

    try {
      await authApi.revokePersonalAccessToken(tokenId);
      setPersonalAccessTokens((current) =>
        current.map((token) =>
          token.id === tokenId
            ? { ...token, revokedAt: new Date().toISOString() }
            : token,
        ),
      );
      setTokenMessage("Personal access token revoked.");
    } catch (error) {
      setTokenMessage(
        getApiErrorMessage(error, {
          action: "revoke that personal access token",
          fallback:
            "We couldn't revoke that personal access token right now. Please try again.",
        }),
      );
    } finally {
      setPendingTokenRevoke(null);
    }
  }

  if (status === "loading") {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-12 text-slate-900 dark:text-white">
        <div className="mx-auto max-w-3xl text-sm font-medium text-slate-500 dark:text-slate-400">
          Loading account...
        </div>
      </main>
    );
  }

  if (status !== "authenticated" || !session) {
    return (
      <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-12 text-slate-900 dark:text-white">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
          <h1 className="text-3xl font-semibold text-slate-950 dark:text-white">
            Account
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Sign in to manage login methods and connected providers.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-slate-50 dark:bg-slate-900 px-6 py-10 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            <User className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Account
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {session.user.email}
            </p>
          </div>
          <span className="ml-auto inline-flex items-center rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium capitalize text-slate-600 dark:text-slate-300">
            {session.user.role}
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 p-1">
          {(["profile", "security", "developer"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() =>
                tab === "security"
                  ? void activateSecurityTab()
                  : setActiveTab(tab)
              }
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                activeTab === tab
                  ? "bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-300 hover:text-slate-900"
              }`}
            >
              {tab === "profile"
                ? "Profile"
                : tab === "security"
                  ? "Security"
                  : "Developer"}
            </button>
          ))}
        </div>

        {/* ── Profile tab ── */}
        {activeTab === "profile" && (
          <div className="space-y-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                <User className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                  Profile
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Your public information
                </p>
              </div>
            </div>

            {profileMessage ? (
              <div
                role="status"
                className={`rounded-xl border px-4 py-3 text-sm ${
                  profileMessageTone === "error"
                    ? "border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
                    : "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
                }`}
              >
                {profileMessage}
              </div>
            ) : null}

            <div className="grid gap-2 text-sm">
              <label
                htmlFor="account-username"
                className="font-medium text-slate-700 dark:text-slate-200"
              >
                Username
              </label>
              <input
                id="account-username"
                name="username"
                autoComplete="username"
                value={profileUsername}
                onChange={(e) => {
                  setProfileUsername(e.target.value);
                  setProfileUsernameError(undefined);
                }}
                disabled={usernameLocked}
                aria-invalid={Boolean(profileUsernameError)}
                aria-describedby={
                  profileUsernameError
                    ? "account-username-error"
                    : "account-username-hint"
                }
                placeholder={profile?.username ?? "username"}
                className="h-11 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-500 dark:disabled:text-slate-400"
              />

              {profileUsernameError ? (
                <FieldErrorMessage
                  id="account-username-error"
                  message={profileUsernameError}
                />
              ) : usernameLocked ? (
                <span
                  id="account-username-hint"
                  className="text-xs leading-5 text-amber-700 dark:text-amber-300"
                >
                  You can only change your username once every 30 days. You can
                  change it again on{" "}
                  {formatCooldownDate(profile?.usernameChangeAvailableAt)}.
                </span>
              ) : (
                <UsernameAvailabilityHint
                  id="account-username-hint"
                  availability={usernameAvailability}
                />
              )}

              <span className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                This is how you sign in and how you recover your account. If you
                signed up with Google or Microsoft, this username was generated
                for you &mdash; changing it the first time is free. After that
                you can change it once every 30 days. Forgot it? Use &ldquo;I
                can&apos;t log in&rdquo; on the sign-in page to have it emailed
                to you.
              </span>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveProfile()}
              disabled={profilePending || profile === null}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {profilePending ? "Saving..." : "Save profile"}
            </button>

            {/* Advanced settings */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white"
              >
                Advanced settings
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 dark:text-slate-500 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {showAdvanced && (
                <div className="mt-4 grid gap-3">
                  <label className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        Private account
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Hide your profile from public listings
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={profileIsPrivate}
                      onChange={(e) => setProfileIsPrivate(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 accent-slate-950"
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        Personalized recommendations
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Use your activity to improve listing suggestions
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={profilePersonalization}
                      onChange={(e) =>
                        setProfilePersonalization(e.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 accent-slate-950"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Security tab — MFA gate ── */}
        {activeTab === "security" && !securityUnlocked && (
          <div className="flex flex-col items-center gap-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-8 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <Lock className="h-7 w-7" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Verify your identity
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                For your security, confirm your identity before accessing
                security settings.
              </p>
            </div>
            {securityChecking ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Checking...
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void handleVerifyIdentity()}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-6 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Verify to continue
              </button>
            )}
          </div>
        )}

        {/* ── Security tab — content ── */}
        {activeTab === "security" && securityUnlocked && (
          <div className="space-y-5">
            {/* Password */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                  <Shield className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                    Password
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {providers?.hasPassword
                      ? "Password login enabled"
                      : "No password set — add one below"}
                  </p>
                </div>
              </div>
              <HomePasswordPanel />
            </div>

            {/* Login methods */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Login methods
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Manage Google, Microsoft, and Apple sign-in for this account.
              </p>

              {message ? (
                <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  {message}
                </div>
              ) : null}

              <div className="mt-4 grid gap-3">
                {providers?.providers.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-950 dark:text-white">
                        {providerLabels[provider.provider]}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {provider.providerEmail ?? "Provider email hidden"} —
                        linked {formatLinkedAt(provider.linkedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleUnlink(provider.provider)}
                      disabled={
                        !canUnlinkProvider ||
                        pendingUnlink === provider.provider
                      }
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        canUnlinkProvider
                          ? `Unlink ${providerLabels[provider.provider]}`
                          : "Add another sign-in method before unlinking"
                      }
                    >
                      <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                      {pendingUnlink === provider.provider
                        ? "Unlinking..."
                        : "Unlink"}
                    </button>
                  </div>
                ))}

                {providers?.providers.length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No external providers linked.
                  </p>
                )}
              </div>

              <div className="mt-4">
                <AuthOAuthButtons
                  mode="link"
                  disabledProviders={
                    Array.from(linkedProviderNames) as OAuthProvider[]
                  }
                  onLinked={(result) => {
                    setProviders(result);
                    setMessage("Provider linked.");
                  }}
                  onError={setMessage}
                />
              </div>
            </div>

            {/* Two-factor authentication */}
            <HomeMfaTotpPanel />

            {/* Phone number (SMS verification) */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
                  <Phone className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    Phone number
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Used for SMS verification when available
                  </p>
                </div>
              </div>

              {phoneMessage ? (
                <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  {phoneMessage}
                </div>
              ) : null}

              <div className="flex gap-3">
                <input
                  type="tel"
                  value={profilePhone}
                  onChange={(e) => setProfilePhone(e.target.value)}
                  placeholder="e.g. +1 555 000 0000"
                  className="h-11 flex-1 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-sm text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                />
                <button
                  type="button"
                  onClick={() => void handleSavePhone()}
                  disabled={phonePending || profile === null}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {phonePending ? "Saving..." : "Save"}
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                SMS verification is coming soon. Your number will be used once
                it&apos;s enabled.
              </p>
            </div>

            {/* Registered devices */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300">
                  <Monitor className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    Registered devices
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Devices that have signed in to your account
                  </p>
                </div>
              </div>

              {devicesMessage ? (
                <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  {devicesMessage}
                </div>
              ) : null}

              <div className="grid gap-3">
                {devices.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
                    No registered devices found.
                  </div>
                ) : (
                  devices.map((device) => (
                    <div
                      key={device.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-950 dark:text-white">
                            {deviceLabel(device)}
                          </p>
                          {device.current && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              This device
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {device.lastIpAddress
                            ? `${device.lastIpAddress} · `
                            : ""}
                          Last seen {formatDateTime(device.lastSeenAt)}
                        </p>
                      </div>
                      {confirmDeviceRemove === device.deviceId ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Remove this device?
                          </span>
                          <button
                            type="button"
                            onClick={() => setConfirmDeviceRemove(null)}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeviceRemove(null);
                              void handleRemoveDevice(device.deviceId);
                            }}
                            disabled={pendingDeviceRemove === device.deviceId}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 text-xs font-semibold text-rose-700 dark:text-rose-300 transition hover:bg-rose-100 dark:hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {pendingDeviceRemove === device.deviceId
                              ? "Removing..."
                              : "Confirm"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeviceRemove(device.deviceId)
                          }
                          disabled={
                            Boolean(device.current) ||
                            pendingDeviceRemove === device.deviceId
                          }
                          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Disable account */}
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    Disable account
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Lock your account and sign out of all sessions
                  </p>
                </div>
              </div>

              <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                Disabling your account will prevent login and hide your profile
                from public listings. Contact support to re-enable it.
              </p>

              {disableMessage ? (
                <div className="mb-4 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                  {disableMessage}
                </div>
              ) : null}

              {disableConfirm ? (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 px-4 py-3">
                  <p className="mb-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                    Are you sure? This will sign you out of all sessions and
                    lock your account.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setDisableConfirm(false)}
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDisableConfirm(false);
                        handleDisableAccount();
                      }}
                      disabled={disablePending}
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-100 dark:bg-rose-950/40 px-4 text-sm font-semibold text-rose-800 dark:text-rose-300 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {disablePending ? "Disabling..." : "Yes, disable account"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDisableConfirm(true)}
                  disabled={disablePending}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 px-4 text-sm font-semibold text-rose-700 dark:text-rose-300 transition hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {disablePending ? "Disabling..." : "Disable account"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Developer tab ── */}
        {activeTab === "developer" && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
                  Personal access tokens
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Create MCP tokens for read-only access or full posting
                  management. The full token value is shown only once.
                </p>
              </div>
            </div>

            {tokenMessage ? (
              <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                {tokenMessage}
              </div>
            ) : null}

            {createdToken ? (
              <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-4">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Copy this token now
                </p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                  After you leave this page, Rentify will only keep the token
                  prefix and metadata.
                </p>
                <code className="mt-3 block overflow-x-auto rounded-lg bg-white dark:bg-slate-900 px-3 py-3 text-sm text-slate-900 dark:text-white">
                  {createdToken}
                </code>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 lg:grid-cols-[1.1fr_0.6fr_0.6fr_auto]">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Token name
                </span>
                <input
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  className="h-11 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                  placeholder="Rentify MCP"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Expires in
                </span>
                <select
                  value={tokenExpiryDays}
                  onChange={(event) => setTokenExpiryDays(event.target.value)}
                  className="h-11 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Access
                </span>
                <select
                  value={tokenAccessLevel}
                  onChange={(event) =>
                    setTokenAccessLevel(event.target.value as "read" | "write")
                  }
                  className="h-11 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-slate-900 dark:text-white outline-none transition focus:border-slate-950 dark:focus:border-slate-400"
                >
                  <option value="read">Read only</option>
                  <option value="write">Read + write</option>
                </select>
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void handleCreatePersonalAccessToken()}
                  disabled={pendingTokenCreate}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingTokenCreate ? "Creating..." : "Create token"}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {personalAccessTokens.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-600 dark:text-slate-300">
                  No personal access tokens have been created yet.
                </div>
              ) : (
                personalAccessTokens.map((token) => (
                  <div
                    key={token.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <p className="font-medium text-slate-950 dark:text-white">
                        {token.name}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {token.tokenPrefix} - scope {token.scopes.join(", ")}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Created {formatDateTime(token.createdAt)} - last used{" "}
                        {formatDateTime(token.lastUsedAt)} - expires{" "}
                        {formatDateTime(token.expiresAt)}
                      </p>
                      {token.revokedAt ? (
                        <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                          Revoked {formatDateTime(token.revokedAt)}
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void handleRevokePersonalAccessToken(token.id)
                      }
                      disabled={
                        Boolean(token.revokedAt) ||
                        pendingTokenRevoke === token.id
                      }
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingTokenRevoke === token.id
                        ? "Revoking..."
                        : token.revokedAt
                          ? "Revoked"
                          : "Revoke"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {verificationDialogOptions ? (
        <MfaVerificationDialog
          open
          initialOptions={verificationDialogOptions}
          scope="mfa-management"
          onVerified={() => {
            verificationResolverRef.current?.(true);
            verificationResolverRef.current = null;
          }}
          onCancel={() => {
            verificationResolverRef.current?.(false);
            verificationResolverRef.current = null;
          }}
        />
      ) : null}
    </main>
  );
}
