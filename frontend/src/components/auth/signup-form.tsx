"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { AuthOAuthButtons } from "@/components/auth/oauth-buttons";
import { SignupVerificationPanel } from "@/components/auth/signup-verification-panel";
import { useAuth } from "@/components/auth/auth-context";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import { authApi } from "@/lib/auth/api";
import type {
  AuthResponseBody,
  SignupVerificationPendingResult,
} from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface SignupErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  captchaToken?: string;
}

function validateSignup(values: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  captchaToken: string;
}): SignupErrors {
  const errors: SignupErrors = {};

  if (!values.firstName.trim()) {
    errors.firstName = "First name is required.";
  }

  if (!values.lastName.trim()) {
    errors.lastName = "Last name is required.";
  }

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Please confirm your password.";
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  if (!values.captchaToken.trim()) {
    errors.captchaToken = "Complete the captcha before creating your account.";
  }

  return errors;
}

interface ApiErrorShape {
  status?: number;
  message?: string;
  body?: {
    error?: string;
    code?: string;
    details?: unknown;
  };
}

type SignupFailureResult = {
  generalError: string | null;
  fieldErrors?: Partial<SignupErrors>;
};

function getSignupFailureResult(error: unknown): SignupFailureResult {
  const apiError = error as ApiErrorShape | undefined;
  const status = apiError?.status;
  const code = apiError?.body?.code;
  const message = apiError?.body?.error ?? apiError?.message;

  if (status === 400) {
    switch (code) {
      case "CAPTCHA_REQUIRED":
      case "CAPTCHA_MISSING":
        return {
          generalError:
            "Please complete the security check before creating your account.",
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
            message || "Your sign-up request was invalid. Please try again.",
        };
    }
  }

  if (status === 409) {
    return {
      generalError:
        message ||
        "An account with this email already exists. Try signing in instead.",
      fieldErrors: {
        email: "This email is already in use.",
      },
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      generalError:
        "Something went wrong on our side. Please try again in a moment.",
    };
  }

  return {
    generalError:
      "We couldn't complete sign up. Check your connection and try again.",
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

function MailIcon() {
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
        d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m5 7 7 5 7-5" strokeLinecap="round" strokeLinejoin="round" />
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

interface SignupFieldProps {
  id: string;
  label: string;
  error?: string;
  hasValue: boolean;
  activeClassName: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function SignupField({
  id,
  label,
  error,
  hasValue,
  activeClassName,
  icon,
  children,
}: SignupFieldProps) {
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
              ? activeClassName
              : theme.auth.fieldDefault
        }`}
      >
        {icon}
        {children}
      </div>

      {error ? <p className={theme.auth.fieldErrorText}>{error}</p> : null}
    </div>
  );
}

export function SignupForm() {
  const router = useRouter();
  const { status, setSession } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [verificationPending, setVerificationPending] =
    useState<SignupVerificationPendingResult | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [router, status]);

  function handleOAuthSuccess(session: AuthResponseBody) {
    setGeneralError(null);
    setSession(session);
    router.replace("/");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateSignup({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      captchaToken,
    });

    setErrors(nextErrors);
    setGeneralError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setPending(true);

    try {
      const result = await authApi.signup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        password,
        captchaToken,
      });

      clearCaptchaToken();
      setVerificationPending(result);
    } catch (error) {
      const failure = getSignupFailureResult(error);

      setGeneralError(failure.generalError);
      setErrors((current) => ({
        ...current,
        ...(failure.fieldErrors ?? {}),
      }));
      clearCaptchaToken();
    } finally {
      setPending(false);
    }
  }

  const firstNameHasValue = useMemo(
    () => firstName.trim().length > 0,
    [firstName],
  );
  const lastNameHasValue = useMemo(
    () => lastName.trim().length > 0,
    [lastName],
  );
  const emailHasValue = useMemo(() => email.trim().length > 0, [email]);
  const passwordHasValue = useMemo(() => password.length > 0, [password]);
  const confirmPasswordHasValue = useMemo(
    () => confirmPassword.length > 0,
    [confirmPassword],
  );

  if (status === "loading") {
    return (
      <div className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-sm">
        Preparing your workspace...
      </div>
    );
  }

  if (status === "authenticated") {
    return null;
  }

  if (verificationPending) {
    return <SignupVerificationPanel result={verificationPending} />;
  }

  return (
    <div className="space-y-5">
      <AuthOAuthButtons
        onSuccess={handleOAuthSuccess}
        onError={setGeneralError}
      />

      <div className="flex items-center gap-3">
        <div className={theme.auth.dividerLine} />
        <span className={theme.auth.dividerText}>Or use email</span>
        <div className={theme.auth.dividerLine} />
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {generalError ? (
          <div className={theme.auth.errorPanel}>{generalError}</div>
        ) : null}

        <div className={theme.auth.fieldGroup}>
          <div className="mb-4">
            <p className={theme.auth.fieldSectionLabel}>Profile</p>
            <p className={theme.auth.fieldSectionDescription}>
              This helps personalize your account from the start.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <SignupField
              id="firstName"
              label="First name"
              error={errors.firstName}
              hasValue={firstNameHasValue}
              activeClassName={theme.auth.fieldActive}
              icon={
                <div className={theme.auth.fieldIcon}>
                  <UserIcon />
                </div>
              }
            >
              <input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                placeholder="Jane"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className={theme.auth.fieldInput}
              />
            </SignupField>

            <SignupField
              id="lastName"
              label="Last name"
              error={errors.lastName}
              hasValue={lastNameHasValue}
              activeClassName={theme.auth.fieldActive}
              icon={
                <div className={theme.auth.fieldIcon}>
                  <UserIcon />
                </div>
              }
            >
              <input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                placeholder="Doe"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={theme.auth.fieldInput}
              />
            </SignupField>
          </div>
        </div>

        <div className={theme.auth.fieldGroup}>
          <div className="mb-4">
            <p className={theme.auth.fieldSectionLabel}>Credentials</p>
            <p className={theme.auth.fieldSectionDescription}>
              Use an email you can verify and a password you will remember.
            </p>
          </div>

          <div className="space-y-5">
            <SignupField
              id="email"
              label="Email"
              error={errors.email}
              hasValue={emailHasValue}
              activeClassName={theme.auth.fieldActive}
              icon={
                <div className={theme.auth.fieldIcon}>
                  <MailIcon />
                </div>
              }
            >
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={theme.auth.fieldInput}
              />
            </SignupField>

            <div className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="password" className={theme.auth.fieldLabel}>
                  Password
                </label>

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
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={theme.auth.fieldInputWithAction}
                  />

                  <button
                    type="button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                    className={theme.auth.iconButton}
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>

                {errors.password ? (
                  <p className={theme.auth.fieldErrorText}>{errors.password}</p>
                ) : (
                  <p className={theme.auth.fieldText}>
                    Use 8 or more characters for a stronger account.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="confirmPassword"
                  className={theme.auth.fieldLabel}
                >
                  Confirm password
                </label>

                <div
                  className={`${theme.auth.fieldShell} ${
                    errors.confirmPassword
                      ? theme.auth.fieldError
                      : confirmPasswordHasValue
                        ? theme.auth.fieldActive
                        : theme.auth.fieldDefault
                  }`}
                >
                  <div className={theme.auth.fieldIcon}>
                    <LockIcon />
                  </div>

                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className={theme.auth.fieldInputWithAction}
                  />

                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showConfirmPassword}
                    onClick={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                    className={theme.auth.iconButton}
                  >
                    {showConfirmPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>

                {errors.confirmPassword ? (
                  <p className={theme.auth.fieldErrorText}>
                    {errors.confirmPassword}
                  </p>
                ) : (
                  <p className={theme.auth.fieldText}>
                    Re-enter your password to confirm there are no typos.
                  </p>
                )}
              </div>
            </div>
          </div>
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
          {pending ? "Creating account..." : "Create account"}
        </button>
      </form>
    </div>
  );
}
