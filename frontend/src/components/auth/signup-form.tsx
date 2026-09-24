"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { AuthField } from "@/components/auth/auth-field";
import {
  CalendarIcon,
  MailIcon,
  UserIcon,
} from "@/components/auth/auth-field-icons";
import {
  AuthFormSteps,
  type AuthFormStep,
} from "@/components/auth/auth-form-steps";
import { AuthPasswordField } from "@/components/auth/auth-password-field";
import { AuthOAuthButtons } from "@/components/auth/oauth-buttons";
import { OAuthSignupDateOfBirthDialog } from "@/components/auth/oauth-signup-date-of-birth-dialog";
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
import { getPasswordStrengthError } from "@/lib/auth/password";
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

const SIGNUP_STEPS: readonly AuthFormStep[] = [
  {
    id: "account",
    title: "Account",
    blurb: "How you will sign in.",
  },
  {
    id: "profile",
    title: "About you",
    blurb: "Your name, a public username, and your date of birth.",
  },
] as const;

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

interface AccountStepValues {
  email: string;
  password: string;
  confirmPassword: string;
}

interface ProfileStepValues {
  firstName: string;
  lastName: string;
  username: string;
  dateOfBirth: string;
  captchaToken: string;
}

function validateAccountStep(values: AccountStepValues): SignupErrors {
  const errors: SignupErrors = {};

  const emailError = validateEmailFormat(values.email);

  if (emailError) {
    errors.email = emailError;
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else {
    // The backend rejects anything `strongPasswordSchema` refuses, so check the
    // same rule here rather than spending a request on a guaranteed 400.
    const passwordError = getPasswordStrengthError(values.password);

    if (passwordError) {
      errors.password = passwordError;
    }
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Please confirm your password.";
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

function validateProfileStep(values: ProfileStepValues): SignupErrors {
  const errors: SignupErrors = {};

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

  const dateOfBirthError = validateDateOfBirth(values.dateOfBirth);
  if (dateOfBirthError) {
    errors.dateOfBirth = dateOfBirthError;
  }

  if (!values.captchaToken.trim()) {
    errors.captchaToken = "Complete the captcha before creating your account.";
  }

  return errors;
}

/**
 * The submit-time gate. It re-checks both steps so a value that was edited
 * after its step was passed — or a step skipped some other way — still cannot
 * reach the API.
 */
function validateSignup(
  values: AccountStepValues & ProfileStepValues,
): SignupErrors {
  return {
    ...validateAccountStep(values),
    ...validateProfileStep(values),
  };
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
  const [currentStep, setCurrentStep] = useState(0);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [welcomeSession, setWelcomeSession] = useState<AuthResponseBody | null>(
    null,
  );
  const [oauthSignupPending, setOAuthSignupPending] =
    useState<OAuthSignupRequiredResult | null>(null);
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

  function goToStep(step: number) {
    setCurrentStep(step);
    setMaxStepReached((current) => Math.max(current, step));
  }

  function handleContinue() {
    const nextErrors = validateAccountStep({
      email,
      password,
      confirmPassword,
    });

    // The availability check already told the user this address is taken, so
    // there is no point letting them fill in a second step that cannot submit.
    if (emailTaken) {
      nextErrors.email = "This email is already in use.";
    }

    setErrors(nextErrors);
    setGeneralError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    goToStep(1);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Both steps live in one form, so once the second step has been reached its
    // submit button stays mounted and becomes the form's default submitter.
    // Without this, pressing Enter on the first step would run the full signup,
    // or raise profile errors on a step the user cannot see.
    if (currentStep === 0) {
      handleContinue();
      return;
    }

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
      // An error from the first step would otherwise be invisible from here.
      if (
        nextErrors.email ||
        nextErrors.password ||
        nextErrors.confirmPassword
      ) {
        setCurrentStep(0);
      }
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

      // A rejected email lives on the first step, so go back to it rather than
      // leaving the user on a step that shows nothing about the failure.
      if (failure.fieldErrors?.email) {
        setCurrentStep(0);
      }

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

      <AuthFormSteps
        steps={SIGNUP_STEPS}
        currentStep={currentStep}
        maxStepReached={maxStepReached}
        onStepChange={setCurrentStep}
        navLabel="Signup steps"
      />

      {generalError ? (
        <FormErrorMessage
          title="Couldn't create your account"
          message={generalError}
        />
      ) : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className={currentStep === 0 ? "space-y-5" : "hidden"}>
          <AuthOAuthButtons
            onSuccess={handleOAuthSuccess}
            onError={setGeneralError}
            onSignupRequired={setOAuthSignupPending}
          />

          <div className="flex items-center gap-3">
            <div className={theme.auth.dividerLine} />
            <span className={theme.auth.dividerText}>Or use an email</span>
            <div className={theme.auth.dividerLine} />
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

          <AuthPasswordField
            id="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="Create a password"
            error={errors.password}
            errorId="signup-password-error"
            hint="At least 8 characters, including uppercase, lowercase, a number, and a special character."
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
          />

          <button
            type="button"
            onClick={handleContinue}
            className={theme.auth.primaryButton}
          >
            Continue
          </button>
        </div>
        {maxStepReached >= 1 ? (
          <div className={currentStep === 1 ? "space-y-5" : "hidden"}>
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

            <AuthField
              id="dateOfBirth"
              label="Date of birth"
              error={errors.dateOfBirth}
              errorId="signup-date-of-birth-error"
              hasValue={dateOfBirthHasValue}
              hint="Used for age-aware experiences. It does not restrict signup."
              icon={
                <div className={theme.auth.fieldIcon}>
                  <CalendarIcon />
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

            <AuthCaptchaPanel
              token={captchaToken}
              error={errors.captchaToken}
              onChange={setCaptchaToken}
              onReset={clearCaptchaToken}
            />

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setCurrentStep(0)}
                disabled={pending}
                className={`${theme.auth.secondaryButton} sm:flex-1`}
              >
                Back
              </button>

              <button
                type="submit"
                disabled={pending}
                className={`${theme.auth.primaryButton} sm:flex-1`}
              >
                {pending ? "Creating account..." : "Create account"}
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
