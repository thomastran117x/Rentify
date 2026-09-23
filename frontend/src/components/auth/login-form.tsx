"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { AuthField } from "@/components/auth/auth-field";
import { UserIcon } from "@/components/auth/auth-field-icons";
import { AuthPasswordField } from "@/components/auth/auth-password-field";
import { LoginUnlockPanel } from "@/components/auth/login-unlock-panel";
import { AuthOAuthButtons } from "@/components/auth/oauth-buttons";
import { OAuthSignupDateOfBirthDialog } from "@/components/auth/oauth-signup-date-of-birth-dialog";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage } from "@/components/errors";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import {
  clearPersistedAuthPendingFlowByType,
  usePersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "@/lib/auth/pending-flow";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  ApiClientError,
  type AuthResponseBody,
  type OAuthSignupRequiredResult,
} from "@/lib/auth/types";
import { validateUsernameFormat } from "@/lib/auth/username";
import { theme } from "@/styles/theme";
import { MfaVerificationDialog } from "@/components/auth/mfa-verification-dialog";
import { AccountRecoveryDialog } from "@/components/auth/account-recovery-dialog";
import { OAuthWelcomeModal } from "@/components/auth/oauth-welcome-modal";
import {
  mfaVerificationApi,
  type MfaVerificationChallengeFactor,
  type MfaVerificationFactor,
  type MfaVerificationOptionsResult,
} from "@/lib/auth/mfa-verification-api";

interface LoginErrors {
  username?: string;
  password?: string;
  captchaToken?: string;
}

function validateLogin(values: {
  username: string;
  password: string;
  captchaToken: string;
}): LoginErrors {
  const errors: LoginErrors = {};
  const usernameError = validateUsernameFormat(values.username);

  if (usernameError) {
    errors.username = usernameError;
  }

  if (!values.password) {
    errors.password = "Password is required.";
  }

  if (!values.captchaToken.trim()) {
    errors.captchaToken = "Complete the captcha before signing in.";
  }

  return errors;
}

type LoginFailureResult = {
  generalError: string | null;
  fieldErrors?: Partial<LoginErrors>;
  unlockEmail?: string;
};

function getLoginFailureResult(error: unknown): LoginFailureResult {
  if (error instanceof ApiClientError) {
    const { status, code, message } = error;
    const details =
      typeof error.details === "object" && error.details !== null
        ? (error.details as { email?: unknown })
        : null;

    if (status === 400) {
      switch (code) {
        case "CAPTCHA_REQUIRED":
        case "CAPTCHA_MISSING":
          return {
            generalError:
              "Please complete the security check before signing in.",
            fieldErrors: {
              captchaToken: "Complete the verification to continue.",
            },
          };

        case "CAPTCHA_INVALID":
        case "CAPTCHA_EXPIRED":
        case "TURNSTILE_VALIDATION_FAILED":
          return {
            generalError:
              "The security check expired or failed. Please try again.",
            fieldErrors: {
              captchaToken: "Please complete the verification again.",
            },
          };

        case "VALIDATION_ERROR":
        case "INVALID_REQUEST":
          return {
            generalError: message || "Please review the form and try again.",
          };

        default:
          return {
            generalError:
              message || "Your sign-in request was invalid. Please try again.",
          };
      }
    }

    if (status === 401) {
      return {
        generalError: "The username or password you entered is incorrect.",
      };
    }

    if (status === 409) {
      switch (code) {
        case "EMAIL_NOT_VERIFIED":
        case "ACCOUNT_NOT_VERIFIED":
          return {
            generalError:
              "Your account has not been verified yet. Please verify your email before signing in.",
          };

        case "AUTH_PROVIDER_MISMATCH":
          return {
            generalError:
              "This account uses a different sign-in method. Use the original provider you signed up with.",
          };

        case "ACCOUNT_DISABLED":
        case "ACCOUNT_LOCKED":
        case "ACCOUNT_SUSPENDED":
          return {
            generalError:
              "This account is currently unavailable. Please contact support if you believe this is a mistake.",
          };

        default:
          return {
            generalError: message || "There is a problem with this account.",
          };
      }
    }

    if (status === 423) {
      return {
        generalError:
          message ||
          "This sign-in is locked. Use the code from your email to unlock it.",
        unlockEmail:
          typeof details?.email === "string" ? details.email : undefined,
      };
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "sign you in",
      fallback: "We couldn't sign you in right now. Please try again.",
    }),
  };
}

interface LoginFormProps {
  nextPath: string;
  initialRecoveryOpen?: boolean;
}

interface DeviceMfaDialogState {
  challengeSent: boolean;
  options: MfaVerificationOptionsResult;
  preferredFactor: MfaVerificationFactor | null;
}

export function LoginForm({
  nextPath,
  initialRecoveryOpen = false,
}: LoginFormProps) {
  const router = useRouter();
  const { status, setSession, clearSession } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken();
  const [errors, setErrors] = useState<LoginErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unlockEmail, setUnlockEmail] = useState<string | null>(null);
  const [accountRecoveryOpen, setAccountRecoveryOpen] =
    useState(initialRecoveryOpen);
  const [welcomeSession, setWelcomeSession] = useState<AuthResponseBody | null>(
    null,
  );
  const [oauthSignupPending, setOAuthSignupPending] =
    useState<OAuthSignupRequiredResult | null>(null);
  const [devicePending, setDevicePending] = useState(false);
  const [deviceMfaDialogState, setDeviceMfaDialogState] =
    useState<DeviceMfaDialogState | null>(null);
  const deviceMfaResolverRef = useRef<((verified: boolean) => void) | null>(
    null,
  );
  const persistedAuthFlow = usePersistedAuthPendingFlow();
  const authFlowRestorePending = persistedAuthFlow === undefined;
  const forgotPasswordPending =
    persistedAuthFlow?.flow === "forgot-password-reset";
  const unlockPendingFlow =
    persistedAuthFlow?.flow === "login-unlock" ? persistedAuthFlow : null;
  const deviceLoginPendingFlow =
    persistedAuthFlow?.flow === "device-login-mfa" ? persistedAuthFlow : null;
  const activeUnlockEmail = unlockEmail ?? unlockPendingFlow?.email ?? null;

  useEffect(() => {
    if (initialRecoveryOpen) {
      setAccountRecoveryOpen(true);
    }
  }, [initialRecoveryOpen]);

  useEffect(() => {
    if (
      !authFlowRestorePending &&
      status === "anonymous" &&
      deviceLoginPendingFlow
    ) {
      clearPersistedAuthPendingFlowByType("device-login-mfa");
    }
  }, [authFlowRestorePending, deviceLoginPendingFlow, status]);

  useEffect(() => {
    if (
      status === "authenticated" &&
      !devicePending &&
      !authFlowRestorePending &&
      !deviceLoginPendingFlow &&
      !welcomeSession
    ) {
      router.replace(nextPath);
    }
  }, [
    authFlowRestorePending,
    deviceLoginPendingFlow,
    devicePending,
    nextPath,
    router,
    status,
    welcomeSession,
  ]);

  useEffect(() => {
    if (
      authFlowRestorePending ||
      status !== "authenticated" ||
      !deviceLoginPendingFlow ||
      deviceMfaDialogState
    ) {
      return;
    }

    let cancelled = false;
    setDevicePending(true);

    void (async () => {
      try {
        const options = await mfaVerificationApi.getOptions("device-login");

        if (cancelled) {
          return;
        }

        if (options.verified || options.availableFactors.length === 0) {
          clearPersistedAuthPendingFlowByType("device-login-mfa");
          await authApi.verifyDevice().catch(() => {});
          setDevicePending(false);
          return;
        }

        setDeviceMfaDialogState({
          challengeSent: deviceLoginPendingFlow.challengeSent,
          options,
          preferredFactor: deviceLoginPendingFlow.selectedFactor,
        });
      } catch {
        if (!cancelled) {
          clearPersistedAuthPendingFlowByType("device-login-mfa");
          setDevicePending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authFlowRestorePending,
    deviceLoginPendingFlow,
    deviceMfaDialogState,
    status,
  ]);

  async function openDeviceMfaDialog(
    options: MfaVerificationOptionsResult,
    preferredFactor: MfaVerificationFactor | null,
    challengeSent: boolean,
  ): Promise<boolean> {
    setDeviceMfaDialogState({
      challengeSent,
      options,
      preferredFactor,
    });

    const verified = await new Promise<boolean>((resolve) => {
      deviceMfaResolverRef.current = resolve;
    });

    setDeviceMfaDialogState(null);
    deviceMfaResolverRef.current = null;
    return verified;
  }

  const handleDeviceMfaCodeEntryStateChange = useCallback(
    (
      state: {
        challengeSent: boolean;
        selectedFactor: MfaVerificationChallengeFactor;
      } | null,
    ) => {
      if (!state) {
        clearPersistedAuthPendingFlowByType("device-login-mfa");
        return;
      }

      writePersistedAuthPendingFlow({
        flow: "device-login-mfa",
        nextPath,
        selectedFactor: state.selectedFactor,
        challengeSent: state.challengeSent,
      });
    },
    [nextPath],
  );

  const completeRestoredDeviceMfaVerification = useCallback(async () => {
    clearPersistedAuthPendingFlowByType("device-login-mfa");
    setDeviceMfaDialogState(null);

    try {
      await authApi.verifyDevice();
      setDevicePending(false);
    } catch {
      await authApi.logout().catch(() => {});
      clearSession();
      setDevicePending(false);
      setGeneralError(
        "We verified your code, but couldn't finish this sign-in. Please try again.",
      );
    }
  }, [clearSession]);

  const cancelRestoredDeviceMfaVerification = useCallback(async () => {
    clearPersistedAuthPendingFlowByType("device-login-mfa");
    setDeviceMfaDialogState(null);
    await authApi.logout().catch(() => {});
    clearSession();
    setDevicePending(false);
    setGeneralError("Sign-in was cancelled. Please try again.");
  }, [clearSession]);

  const handleDeviceMfaVerified = useCallback(() => {
    clearPersistedAuthPendingFlowByType("device-login-mfa");

    if (deviceMfaResolverRef.current) {
      const resolve = deviceMfaResolverRef.current;
      deviceMfaResolverRef.current = null;
      resolve(true);
      return;
    }

    void completeRestoredDeviceMfaVerification();
  }, [completeRestoredDeviceMfaVerification]);

  const handleDeviceMfaCancel = useCallback(() => {
    clearPersistedAuthPendingFlowByType("device-login-mfa");

    if (deviceMfaResolverRef.current) {
      const resolve = deviceMfaResolverRef.current;
      deviceMfaResolverRef.current = null;
      resolve(false);
      return;
    }

    void cancelRestoredDeviceMfaVerification();
  }, [cancelRestoredDeviceMfaVerification]);

  async function completeLogin(session: AuthResponseBody) {
    clearPersistedAuthPendingFlowByType("login-unlock");

    if (!session.device.known && !session.device.knownByIp) {
      setDevicePending(true);
      setSession(session);

      try {
        const options = await mfaVerificationApi.getOptions("device-login");

        if (options.verified || options.availableFactors.length === 0) {
          clearPersistedAuthPendingFlowByType("device-login-mfa");
          await authApi.verifyDevice().catch(() => {});
        } else {
          const verified = await openDeviceMfaDialog(
            options,
            options.recommendedFactor,
            false,
          );

          if (verified) {
            clearPersistedAuthPendingFlowByType("device-login-mfa");
            await authApi.verifyDevice().catch(() => {});
          } else {
            clearPersistedAuthPendingFlowByType("device-login-mfa");
            await authApi.logout().catch(() => {});
            setDevicePending(false);
            setGeneralError("Sign-in was cancelled. Please try again.");
            return;
          }
        }
      } catch {
        clearPersistedAuthPendingFlowByType("device-login-mfa");
      }

      setDevicePending(false);
    } else {
      clearPersistedAuthPendingFlowByType("device-login-mfa");
      setSession(session);
      if (!session.device.known) {
        authApi.verifyDevice().catch(() => {});
      }
    }
  }

  function handleOAuthSuccess(session: AuthResponseBody) {
    setGeneralError(null);
    setUnlockEmail(null);
    clearPersistedAuthPendingFlowByType("login-unlock");
    setSession(session);
    setOAuthSignupPending(null);
    if (!session.device.known) {
      authApi.verifyDevice().catch(() => {});
    }
    if (session.isNewUser) {
      setWelcomeSession(session);
    }
  }

  function handleWelcomeUsernameSaved(nextUsername: string) {
    if (!welcomeSession) {
      return;
    }

    const updated: AuthResponseBody = {
      ...welcomeSession,
      user: { ...welcomeSession.user, username: nextUsername },
    };
    setWelcomeSession(updated);
    setSession(updated);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateLogin({ username, password, captchaToken });
    setErrors(nextErrors);
    setGeneralError(null);
    setUnlockEmail(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setPending(true);

    try {
      const session = await authApi.login({
        username: username.trim().toLowerCase(),
        password,
        captchaToken,
      });

      clearCaptchaToken();
      await completeLogin(session);
    } catch (error) {
      const failure = getLoginFailureResult(error);

      setGeneralError(failure.generalError);
      setUnlockEmail(failure.unlockEmail ?? null);
      if (failure.unlockEmail) {
        writePersistedAuthPendingFlow({
          flow: "login-unlock",
          email: failure.unlockEmail,
        });
      } else {
        clearPersistedAuthPendingFlowByType("login-unlock");
      }
      setErrors((current) => ({
        ...current,
        ...(failure.fieldErrors ?? {}),
      }));
      clearCaptchaToken();
    } finally {
      setPending(false);
    }
  }

  const usernameHasValue = useMemo(
    () => username.trim().length > 0,
    [username],
  );

  if (status === "loading" || authFlowRestorePending) {
    return (
      <div className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm">
        Preparing your workspace...
      </div>
    );
  }

  if (status === "authenticated" && !devicePending && !deviceLoginPendingFlow) {
    if (welcomeSession) {
      return (
        <OAuthWelcomeModal
          open={true}
          username={welcomeSession.user.username}
          onUsernameSaved={handleWelcomeUsernameSaved}
          onClose={() => setWelcomeSession(null)}
        />
      );
    }
    return null;
  }

  if (activeUnlockEmail) {
    return (
      <LoginUnlockPanel
        email={activeUnlockEmail}
        onUnlocked={(message) => {
          clearPersistedAuthPendingFlowByType("login-unlock");
          setUnlockEmail(null);
          setGeneralError(message);
        }}
        onCancel={() => {
          clearPersistedAuthPendingFlowByType("login-unlock");
          setUnlockEmail(null);
          setGeneralError(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <AccountRecoveryDialog
        initialView={forgotPasswordPending ? "password" : "options"}
        open={accountRecoveryOpen || forgotPasswordPending}
        onClose={() => {
          clearPersistedAuthPendingFlowByType("forgot-password-reset");
          setAccountRecoveryOpen(false);
        }}
      />
      {deviceMfaDialogState ? (
        <MfaVerificationDialog
          open={true}
          initialChallengeSent={deviceMfaDialogState.challengeSent}
          initialOptions={deviceMfaDialogState.options}
          preferredFactor={deviceMfaDialogState.preferredFactor}
          scope="device-login"
          onCodeEntryStateChange={handleDeviceMfaCodeEntryStateChange}
          onVerified={handleDeviceMfaVerified}
          onCancel={handleDeviceMfaCancel}
        />
      ) : null}
      {oauthSignupPending ? (
        <OAuthSignupDateOfBirthDialog
          pendingSignup={oauthSignupPending}
          onSuccess={handleOAuthSuccess}
          onCancel={() => {
            setOAuthSignupPending(null);
            setGeneralError(
              "Social signup was cancelled. No account was created.",
            );
          }}
        />
      ) : null}
      <AuthOAuthButtons
        onSuccess={handleOAuthSuccess}
        onError={setGeneralError}
        onSignupRequired={setOAuthSignupPending}
      />

      <div className="flex items-center gap-3">
        <div className={theme.auth.dividerLine} />
        <span className={theme.auth.dividerText}>Or use username</span>
        <div className={theme.auth.dividerLine} />
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {generalError ? (
          <FormErrorMessage
            title="Couldn't sign you in"
            message={generalError}
          />
        ) : null}

        <AuthField
          id="username"
          label="Username"
          error={errors.username}
          errorId="login-username-error"
          hasValue={usernameHasValue}
          icon={
            <div className={theme.auth.fieldIcon}>
              <UserIcon />
            </div>
          }
        >
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder="your-username"
            aria-invalid={Boolean(errors.username)}
            aria-describedby={
              errors.username ? "login-username-error" : undefined
            }
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={theme.auth.fieldInput}
          />
        </AuthField>

        <AuthPasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Enter your password"
          error={errors.password}
          errorId="login-password-error"
          labelAction={
            <button
              type="button"
              onClick={() => setAccountRecoveryOpen(true)}
              className={theme.auth.textLink}
            >
              I can&apos;t log in
            </button>
          }
        />

        <AuthCaptchaPanel
          token={captchaToken}
          error={errors.captchaToken}
          onChange={setCaptchaToken}
          onReset={clearCaptchaToken}
        />

        <button
          type="submit"
          disabled={pending}
          className={theme.auth.primaryButton}
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
