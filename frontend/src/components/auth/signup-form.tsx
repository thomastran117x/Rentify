"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { AuthField } from "@/components/auth/auth-field";
import { MailIcon, UserIcon } from "@/components/auth/auth-field-icons";
import { AuthPasswordField } from "@/components/auth/auth-password-field";
import { AuthOAuthButtons } from "@/components/auth/oauth-buttons";
import { OAuthWelcomeModal } from "@/components/auth/oauth-welcome-modal";
import { SignupVerificationPanel } from "@/components/auth/signup-verification-panel";
import { useAuth } from "@/components/auth/auth-context";
import { FormErrorMessage } from "@/components/errors";
import { useAuthCaptchaToken } from "@/lib/auth/captcha-store";
import {
  clearPersistedAuthPendingFlowByType,
  usePersistedAuthPendingFlow,
  writePersistedAuthPendingFlow,
} from "@/lib/auth/pending-flow";
import { authApi } from "@/lib/auth/api";
import { normalizeEmail, validateEmailFormat } from "@/lib/auth/email";
import { normalizeUsername, validateUsernameFormat } from "@/lib/auth/username";
import {
  getCurrentUtcDateOnly,
  validateDateOfBirth,
} from "@/lib/auth/date-of-birth";
import { useEmailAvailability } from "@/lib/auth/use-email-availability";
import {
  getUsernameAvailabilityError,
  useUsernameAvailability,
} from "@/lib/auth/use-username-availability";
import { EmailAvailabilityHint } from "@/components/auth/email-availability-hint";
import { UsernameAvailabilityHint } from "@/components/auth/username-availability-hint";
import { UsernameSuggestions } from "@/components/auth/username-suggestions";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type {
  AuthResponseBody,
  OAuthSignupRequiredResult,
} from "@/lib/auth/types";
import { ApiClientError } from "@/lib/auth/types";
import { theme } from "@/styles/theme";

interface SignupErrors {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  dateOfBirth?: string;
  captchaToken?: string;
}

function validateSignup(values: {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  dateOfBirth: string;
  captchaToken: string;
}): SignupErrors {
  const errors: SignupErrors = {};

  const dateOfBirthError = validateDateOfBirth(values.dateOfBirth);
  if (dateOfBirthError) {
    errors.dateOfBirth = dateOfBirthError;
  }

  if (!values.firstName.trim()) {
    errors.firstName = "First name is required.";
  }

  if (!values.lastName.trim()) {
    errors.lastName = "Last name is required.";
  }

  const usernameError = validateUsernameFormat(values.username);

  if (usernameError) {
    errors.username = usernameError;
  }

  const emailError = validateEmailFormat(values.email);

  if (emailError) {
    errors.email = emailError;
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

type SignupFailureResult = {
  generalError: string | null;
  fieldErrors?: Partial<SignupErrors>;
};

function getSignupFailureResult(error: unknown): SignupFailureResult {
  if (error instanceof ApiClientError) {
    const { status, code, message } = error;
    const details =
      typeof error.details === "object" && error.details !== null
        ? (error.details as { field?: unknown })
        : null;

    if (status === 400) {
      if (details?.field === "username") {
        return {
          generalError: message || "That username isn’t allowed.",
          fieldErrors: {
            username: message || "That username isn’t allowed.",
          },
        };
      }

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
      if (details?.field === "username") {
        return {
          generalError: message || "That username is already taken.",
          fieldErrors: {
            username: "That username is already taken.",
          },
        };
      }

      return {
        generalError:
          message ||
          "An account with this email already exists. Try signing in instead.",
        fieldErrors: {
          email: "This email is already in use.",
        },
      };
    }
  }

  return {
    generalError: getApiErrorMessage(error, {
      action: "create your account",
      fallback: "We couldn't create your account right now. Please try again.",
    }),
  };
}

interface SignupFormProps {
  nextPath?: string;
}

export function SignupForm({ nextPath = "/" }: SignupFormProps) {
  const router = useRouter();
  const { status, setSession } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [suggestedUsername, setSuggestedUsername] = useState<
    string | undefined
  >();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [captchaToken, setCaptchaToken, clearCaptchaToken] =
    useAuthCaptchaToken();
  const [errors, setErrors] = useState<SignupErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [welcomeSession, setWelcomeSession] = useState<AuthResponseBody | null>(
    null,
  );
  const persistedAuthFlow = usePersistedAuthPendingFlow();
  const verificationPending =
    persistedAuthFlow?.flow === "signup-verification"
      ? persistedAuthFlow
      : null;
  const authFlowRestorePending = persistedAuthFlow === undefined;
  const usernameAvailability = useUsernameAvailability(username, {
    suggestedUsername,
  });
  const usernameAvailabilityError =
    getUsernameAvailabilityError(usernameAvailability);
  const emailAvailability = useEmailAvailability(email);
  // Only a taken address blocks. `pending` is informational — signup accepts an
  // address whose verification is unfinished — and `error` must never wedge the
  // form, since the backend still enforces uniqueness on submit.
  const emailTaken = emailAvailability.status === "taken";

  useEffect(() => {
    if (status === "authenticated" && !welcomeSession) {
      clearPersistedAuthPendingFlowByType("signup-verification");
      router.replace(nextPath);
    }
  }, [nextPath, router, status, welcomeSession]);

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

  function handleOAuthSuccess(session: AuthResponseBody) {
    setGeneralError(null);
    setSession(session);
    if (session.isNewUser) {
      setWelcomeSession(session);
      return;
    }
    router.replace(nextPath);
  }

  function validateDateBeforeOAuth(): boolean {
    const dateError = validateDateOfBirth(dateOfBirth);
    setErrors((current) => ({
      ...current,
      dateOfBirth: dateError ?? undefined,
    }));
    setGeneralError(null);
    return dateError === null;
  }

  async function handleOAuthSignupRequired(result: OAuthSignupRequiredResult) {
    if (!validateDateBeforeOAuth()) {
      return;
    }

    try {
      handleOAuthSuccess(
        await authApi.completeOAuthSignup({
          signupToken: result.signupToken,
          dateOfBirth,
        }),
      );
    } catch (error) {
      setGeneralError(
        getApiErrorMessage(error, {
          action: "complete your account",
          fallback: "We couldn't complete your account. Please try again.",
        }),
      );
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateSignup({
      firstName,
      lastName,
      username,
      email,
      password,
      confirmPassword,
      dateOfBirth,
      captchaToken,
    });

    // The availability check already told the user this name is gone; there is
    // nothing to gain from a round trip that can only fail.
    if (usernameAvailabilityError) {
      nextErrors.username = usernameAvailabilityError;
    }

    if (emailTaken) {
      nextErrors.email = "This email is already in use.";
    }

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
        username: normalizeUsername(username),
        email: normalizeEmail(email),
        password,
        dateOfBirth,
        captchaToken,
      });

      clearCaptchaToken();
      writePersistedAuthPendingFlow({
        flow: "signup-verification",
        email: result.email,
        nextPath,
        alreadyPending: result.alreadyPending,
      });
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
  const usernameHasValue = useMemo(
    () => username.trim().length > 0,
    [username],
  );
  const emailHasValue = useMemo(() => email.trim().length > 0, [email]);
  const dateOfBirthHasValue = useMemo(
    () => dateOfBirth.length > 0,
    [dateOfBirth],
  );

  if (status === "loading" || authFlowRestorePending) {
    return (
      <div className="rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm">
        Preparing your workspace...
      </div>
    );
  }

  if (status === "authenticated") {
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

  if (verificationPending) {
    return (
      <SignupVerificationPanel
        result={{
          verificationRequired: true,
          email: verificationPending.email,
          alreadyPending: verificationPending.alreadyPending,
        }}
        nextPath={verificationPending.nextPath}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className={theme.auth.fieldGroup}>
        <div className="mb-4">
          <p className={theme.auth.fieldSectionLabel}>Age information</p>
          <p className={theme.auth.fieldSectionDescription}>
            Your date of birth supports age-aware marketplace experiences. It
            does not prevent people under 18 from signing up.
          </p>
        </div>

        <AuthField
          id="dateOfBirth"
          label="Date of birth"
          error={errors.dateOfBirth}
          errorId="signup-date-of-birth-error"
          hasValue={dateOfBirthHasValue}
          icon={
            <div className={theme.auth.fieldIcon}>
              <UserIcon />
            </div>
          }
        >
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            autoComplete="bday"
            max={getCurrentUtcDateOnly()}
            aria-invalid={Boolean(errors.dateOfBirth)}
            aria-describedby={
              errors.dateOfBirth ? "signup-date-of-birth-error" : undefined
            }
            value={dateOfBirth}
            onChange={(event) => {
              setDateOfBirth(event.target.value);
              if (errors.dateOfBirth) {
                setErrors((current) => ({
                  ...current,
                  dateOfBirth: undefined,
                }));
              }
            }}
            className={theme.auth.fieldInput}
          />
        </AuthField>
      </div>

      <AuthOAuthButtons
        onSuccess={handleOAuthSuccess}
        onError={setGeneralError}
        dateOfBirth={dateOfBirth}
        beforeAuthenticate={validateDateBeforeOAuth}
        onSignupRequired={(result) => void handleOAuthSignupRequired(result)}
      />

      <div className="flex items-center gap-3">
        <div className={theme.auth.dividerLine} />
        <span className={theme.auth.dividerText}>
          Or continue with a username
        </span>
        <div className={theme.auth.dividerLine} />
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {generalError ? (
          <FormErrorMessage
            title="Couldn't create your account"
            message={generalError}
          />
        ) : null}

        <div className={theme.auth.fieldGroup}>
          <div className="mb-4">
            <p className={theme.auth.fieldSectionLabel}>Profile</p>
            <p className={theme.auth.fieldSectionDescription}>
              This helps personalize your account from the start.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <AuthField
              id="firstName"
              label="First name"
              error={errors.firstName}
              errorId="signup-first-name-error"
              hasValue={firstNameHasValue}
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
                aria-invalid={Boolean(errors.firstName)}
                aria-describedby={
                  errors.firstName ? "signup-first-name-error" : undefined
                }
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className={theme.auth.fieldInput}
              />
            </AuthField>

            <AuthField
              id="lastName"
              label="Last name"
              error={errors.lastName}
              errorId="signup-last-name-error"
              hasValue={lastNameHasValue}
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
                aria-invalid={Boolean(errors.lastName)}
                aria-describedby={
                  errors.lastName ? "signup-last-name-error" : undefined
                }
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={theme.auth.fieldInput}
              />
            </AuthField>
          </div>
        </div>

        <div className={theme.auth.fieldGroup}>
          <div className="mb-4">
            <p className={theme.auth.fieldSectionLabel}>Credentials</p>
            <p className={theme.auth.fieldSectionDescription}>
              Choose a public username, an email you can verify, and a password
              you will remember.
            </p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <AuthField
                id="username"
                label="Username"
                error={errors.username}
                errorId="signup-username-error"
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
                  placeholder="jane-doe"
                  aria-invalid={
                    Boolean(errors.username) ||
                    Boolean(usernameAvailabilityError)
                  }
                  aria-describedby={
                    errors.username
                      ? "signup-username-error"
                      : "signup-username-availability"
                  }
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setSuggestedUsername(undefined);
                    setErrors((current) => ({
                      ...current,
                      username: undefined,
                    }));
                  }}
                  className={theme.auth.fieldInput}
                />
              </AuthField>

              {/* Suppressed while a format error is showing, so the field never
                  carries two competing messages. */}
              {errors.username ? null : (
                <UsernameAvailabilityHint
                  id="signup-username-availability"
                  availability={usernameAvailability}
                />
              )}
              <UsernameSuggestions
                disabled={pending}
                onSelect={(suggestion) => {
                  setUsername(suggestion);
                  setSuggestedUsername(suggestion);
                  setErrors((current) => ({
                    ...current,
                    username: undefined,
                  }));
                }}
              />
            </div>

            <div className="space-y-2">
              <AuthField
                id="email"
                label="Email"
                error={errors.email}
                errorId="signup-email-error"
                hasValue={emailHasValue}
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
                  aria-invalid={Boolean(errors.email) || emailTaken}
                  aria-describedby={
                    errors.email
                      ? "signup-email-error"
                      : "signup-email-availability"
                  }
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={theme.auth.fieldInput}
                />
              </AuthField>

              {/* Suppressed while a format error is showing, so the field never
                  carries two competing messages. */}
              {errors.email ? null : (
                <EmailAvailabilityHint
                  id="signup-email-availability"
                  availability={emailAvailability}
                />
              )}
            </div>

            <div className="space-y-5">
              <AuthPasswordField
                id="password"
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                error={errors.password}
                errorId="signup-password-error"
                hint="Use 8 or more characters for a stronger account."
              />

              <AuthPasswordField
                id="confirmPassword"
                label="Confirm password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                placeholder="Repeat your password"
                error={errors.confirmPassword}
                errorId="signup-confirm-password-error"
                hint="Re-enter your password to confirm there are no typos."
              />
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
