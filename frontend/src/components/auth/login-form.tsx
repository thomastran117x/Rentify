"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { LoginUnlockPanel } from "@/components/auth/login-unlock-panel";
import { AuthOAuthButtons } from "@/components/auth/oauth-buttons";
import { useAuth } from "@/components/auth/auth-context";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import {
  clearPersistedAuthPendingFlowByType,
  usePersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "@/lib/auth/pending-flow";
import { authApi } from "@/lib/auth/api";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiClientError, type AuthResponseBody } from "@/lib/auth/types";
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

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 20a7.5 7.5 0 0 1 15 0"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M7 10V8a5 5 0 0 1 10 0v2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="4"
        y="10"
        width="16"
        height="10"
        rx="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeOpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5s8.268 2.943 9.542 7c-1.274 4.057-5.065 7-9.542 7S3.732 16.057 2.458 12Z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.585 10.587A2 2 0 0 0 12 16a2 2 0 0 0 1.414-.586"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.88 5.09A10.94 10.94 0 0 1 12 5c4.477 0 8.268 2.943 9.542 7a10.96 10.96 0 0 1-4.126 5.169"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.228 6.228A10.958 10.958 0 0 0 2.458 12c1.274 4.057 5.065 7 9.542 7 1.55 0 3.026-.354 4.34-.987"
      />
    </svg>
  );
}

interface LoginFieldProps {
  id: string;
  label: string;
  error?: string;
  errorId?: string;
  hasValue: boolean;
  icon: React.ReactNode;
  iconClassName: string;
  children: React.ReactNode;
}

function LoginField({
  id,
  label,
  error,
  errorId,
  hasValue,
  icon,
  iconClassName,
  children,
}: LoginFieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className={theme.auth.fieldLabel}>
        {label}
      </label>

      <div
        className={`${theme.auth.fieldShell} ${
          error
            ? theme.auth.fieldError
            : hasValue
              ? iconClassName
              : theme.auth.fieldDefault
        }`}
      >
        {icon}
        {children}
      </div>

      <FieldErrorMessage id={errorId ?? `${id}-error`} message={error} />
    </div>
  );
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
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unlockEmail, setUnlockEmail] = useState<string | null>(null);
  const [accountRecoveryOpen, setAccountRecoveryOpen] =
    useState(initialRecoveryOpen);
  const [welcomeSession, setWelcomeSession] = useState<AuthResponseBody | null>(
    null,
  );
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
  const passwordHasValue = useMemo(() => password.length > 0, [password]);

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
      <AuthOAuthButtons
        onSuccess={handleOAuthSuccess}
        onError={setGeneralError}
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

        <LoginField
          id="username"
          label="Username"
          error={errors.username}
          errorId="login-username-error"
          hasValue={usernameHasValue}
          iconClassName={theme.auth.fieldActive}
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
        </LoginField>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className={theme.auth.fieldLabel}>
              Password
            </label>

            <button
              type="button"
              onClick={() => setAccountRecoveryOpen(true)}
              className={theme.auth.textLink}
            >
              I can&apos;t log in
            </button>
          </div>

          <div
            className={`${theme.auth.fieldShell} ${
              errors.password
                ? theme.auth.fieldError
                : passwordHasValue
                  ? theme.auth.fieldActive
                  : theme.auth.fieldDefault
            }`}
          >
            <div className={theme.auth.fieldIcon}>
              <LockIcon />
            </div>

            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password ? "login-password-error" : undefined
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={theme.auth.fieldInputWithAction}
            />

            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
              className={theme.auth.iconButton}
            >
              {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
            </button>
          </div>

          <FieldErrorMessage
            id="login-password-error"
            message={errors.password}
          />
        </div>

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
