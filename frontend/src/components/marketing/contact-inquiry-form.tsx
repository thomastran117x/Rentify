"use client";

import { FormEvent, useEffect, useState } from "react";
import { AuthCaptchaPanel } from "@/components/auth/auth-captcha-panel";
import { useAuth } from "@/components/auth/auth-context";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { ApiError } from "@/lib/api/types";
import { feedbackApi, type FeedbackCategory } from "@/lib/feedback/api";

interface FeedbackValues {
  name: string;
  email: string;
  category: FeedbackCategory;
  message: string;
  captchaToken: string;
}

type FeedbackErrors = Partial<Record<keyof FeedbackValues, string>>;

const CATEGORY_OPTIONS: Array<{
  value: FeedbackCategory;
  label: string;
  description: string;
}> = [
  {
    value: "bug_report",
    label: "Bug report",
    description: "Something broke or behaved unexpectedly.",
  },
  {
    value: "feature_request",
    label: "Feature request",
    description: "An idea that would make Rentify more useful.",
  },
  {
    value: "usability",
    label: "Usability",
    description: "The workflow is confusing, slow, or hard to complete.",
  },
  {
    value: "praise",
    label: "Praise",
    description: "Something in the app is working especially well.",
  },
  {
    value: "other",
    label: "Other",
    description: "General product feedback that does not fit elsewhere.",
  },
];

const DEFAULT_CATEGORY: FeedbackCategory = "bug_report";

const initialValues: FeedbackValues = {
  name: "",
  email: "",
  category: DEFAULT_CATEGORY,
  message: "",
  captchaToken: "",
};

function getCategoryLabel(category: FeedbackCategory): string {
  return (
    CATEGORY_OPTIONS.find((option) => option.value === category)?.label ??
    "Feedback"
  );
}

function deriveSignedInName(input: {
  username?: string;
  email: string;
}): string {
  const username = input.username?.trim();

  if (username) {
    return username;
  }

  return input.email.split("@")[0] ?? input.email;
}

function readDetailMessage(
  details: unknown,
  key: keyof FeedbackValues,
): string | undefined {
  if (!details || typeof details !== "object" || !(key in details)) {
    return undefined;
  }

  const value = (details as Record<string, unknown>)[key];

  if (!Array.isArray(value) || typeof value[0] !== "string") {
    return undefined;
  }

  return value[0];
}

function validateFeedback(
  values: FeedbackValues,
  isAuthenticated: boolean,
): FeedbackErrors {
  const errors: FeedbackErrors = {};

  if (!values.name.trim()) {
    errors.name = "Please enter your name.";
  }

  if (!values.email.trim()) {
    errors.email = "Please enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Please use a valid email address.";
  }

  if (!values.category.trim()) {
    errors.category = "Please choose a feedback type.";
  }

  if (!values.message.trim()) {
    errors.message = "Please share your feedback.";
  } else if (values.message.trim().length < 10) {
    errors.message = "Please include at least 10 characters of detail.";
  }

  if (!isAuthenticated && !values.captchaToken.trim()) {
    errors.captchaToken = "Complete the verification before sending feedback.";
  }

  return errors;
}

function getFieldClassName(hasError: boolean) {
  return [
    "rounded-2xl border bg-white/90 px-4 py-3 text-slate-900 outline-none transition",
    hasError
      ? "border-rose-300 focus:border-rose-400"
      : "border-slate-200 focus:border-violet-300 focus:bg-white",
  ].join(" ");
}

export function ContactInquiryForm() {
  const { status, session } = useAuth();
  const isAuthenticated = status === "authenticated" && Boolean(session);
  const [values, setValues] = useState<FeedbackValues>(initialValues);
  const [errors, setErrors] = useState<FeedbackErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !session) {
      return;
    }

    setValues((current) => ({
      ...current,
      name:
        current.name.trim() ||
        deriveSignedInName({
          username: session.user.username,
          email: session.user.email,
        }),
      email: current.email.trim() || session.user.email,
    }));
  }, [isAuthenticated, session]);

  function updateValue<K extends keyof FeedbackValues>(
    key: K,
    value: FeedbackValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSuccessMessage(null);
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateFeedback(values, isAuthenticated);
    setErrors(nextErrors);
    setSubmitError(null);
    setSuccessMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await feedbackApi.create({
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        category: values.category,
        message: values.message.trim(),
        ...(isAuthenticated
          ? {}
          : {
              captchaToken: values.captchaToken.trim(),
            }),
      });

      setValues((current) => ({
        ...current,
        category: DEFAULT_CATEGORY,
        message: "",
        captchaToken: "",
      }));
      setSuccessMessage(
        `Thanks. Your ${getCategoryLabel(result.category).toLowerCase()} has been sent to the Rentify team.`,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        const nextFieldErrors: FeedbackErrors = {
          name: readDetailMessage(error.details, "name"),
          email: readDetailMessage(error.details, "email"),
          category: readDetailMessage(error.details, "category"),
          message: readDetailMessage(error.details, "message"),
          captchaToken: readDetailMessage(error.details, "captchaToken"),
        };

        if (error.message === "Captcha verification failed.") {
          nextFieldErrors.captchaToken =
            "Please complete the verification again.";
          setValues((current) => ({
            ...current,
            captchaToken: "",
          }));
        }

        if (Object.values(nextFieldErrors).some(Boolean)) {
          setErrors((current) => ({
            ...current,
            ...nextFieldErrors,
          }));
        }

        setSubmitError(
          getApiErrorMessage(error, {
            action: "send your feedback",
            fallback:
              "We couldn't send your feedback right now. Please try again.",
          }),
        );
      } else {
        setSubmitError(
          getApiErrorMessage(error, {
            action: "send your feedback",
            fallback:
              "We couldn't send your feedback right now. Please try again.",
          }),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-[2.25rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/10 sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-600">
          Name
          <input
            type="text"
            value={values.name}
            onChange={(event) => updateValue("name", event.target.value)}
            placeholder="Your name"
            className={getFieldClassName(Boolean(errors.name))}
          />
          {errors.name ? (
            <span className="text-xs text-rose-700">{errors.name}</span>
          ) : null}
        </label>

        <label className="grid gap-2 text-sm text-slate-600">
          Email
          <input
            type="email"
            value={values.email}
            onChange={(event) => updateValue("email", event.target.value)}
            placeholder="you@example.com"
            className={getFieldClassName(Boolean(errors.email))}
          />
          {errors.email ? (
            <span className="text-xs text-rose-700">{errors.email}</span>
          ) : null}
        </label>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[0.95fr_1.05fr]">
        <label className="grid gap-2 text-sm text-slate-600">
          Feedback type
          <select
            value={values.category}
            onChange={(event) =>
              updateValue("category", event.target.value as FeedbackCategory)
            }
            className={getFieldClassName(Boolean(errors.category))}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.category ? (
            <span className="text-xs text-rose-700">{errors.category}</span>
          ) : null}
        </label>

        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
          {CATEGORY_OPTIONS.find((option) => option.value === values.category)
            ?.description ?? "Tell us what happened and what would help."}
        </div>
      </div>

      <label className="mt-5 grid gap-2 text-sm text-slate-600">
        What should the team know?
        <textarea
          rows={6}
          value={values.message}
          onChange={(event) => updateValue("message", event.target.value)}
          placeholder="Share the workflow, page, or problem you hit, plus anything that would make the app better."
          className={[
            "rounded-[1.5rem] border bg-white/90 px-4 py-3 text-slate-900 outline-none transition",
            errors.message
              ? "border-rose-300 focus:border-rose-400"
              : "border-slate-200 focus:border-violet-300 focus:bg-white",
          ].join(" ")}
        />
        {errors.message ? (
          <span className="text-xs text-rose-700">{errors.message}</span>
        ) : null}
      </label>

      {isAuthenticated && session ? (
        <div className="mt-5 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900">
          Signed in as {session.user.email}. We will attach your account context
          automatically so the team can better understand the feedback.
        </div>
      ) : (
        <div className="mt-5">
          <AuthCaptchaPanel
            token={values.captchaToken}
            error={errors.captchaToken}
            onChange={(token) => updateValue("captchaToken", token)}
            onReset={() => updateValue("captchaToken", "")}
          />
        </div>
      )}

      {submitError ? (
        <div className="mt-5 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
          {submitError}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-xs leading-6 text-slate-500">
          Product feedback helps us improve search, booking, owner workflows,
          and overall app usability. Include enough detail for the team to
          reproduce the issue or understand the request.
        </p>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-y-0"
        >
          {isSubmitting ? "Sending feedback..." : "Send feedback"}
        </button>
      </div>

      {successMessage ? (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          {successMessage}
        </div>
      ) : null}
    </form>
  );
}
