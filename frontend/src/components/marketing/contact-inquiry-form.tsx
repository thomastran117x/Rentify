"use client";

import { FormEvent, useState } from "react";

interface InquiryValues {
  name: string;
  email: string;
  company: string;
  focusArea: string;
  projectNotes: string;
}

type InquiryErrors = Partial<Record<keyof InquiryValues, string>>;

const initialValues: InquiryValues = {
  name: "",
  email: "",
  company: "",
  focusArea: "Finding the right rental",
  projectNotes: "",
};

function validateInquiry(values: InquiryValues): InquiryErrors {
  const errors: InquiryErrors = {};

  if (!values.name.trim()) {
    errors.name = "Please enter your name.";
  }

  if (!values.email.trim()) {
    errors.email = "Please enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Please use a valid email address.";
  }

  if (!values.focusArea.trim()) {
    errors.focusArea = "Please choose a focus area.";
  }

  if (!values.projectNotes.trim()) {
    errors.projectNotes = "Please share a few project details.";
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
  const [values, setValues] = useState<InquiryValues>(initialValues);
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  function updateValue<K extends keyof InquiryValues>(
    key: K,
    value: InquiryValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setIsSubmitted(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateInquiry(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    setIsSubmitting(false);
    setIsSubmitted(true);
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

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-600">
          Company or portfolio
          <input
            type="text"
            value={values.company}
            onChange={(event) => updateValue("company", event.target.value)}
            placeholder="Optional"
            className={getFieldClassName(false)}
          />
        </label>

        <label className="grid gap-2 text-sm text-slate-600">
          Focus area
          <select
            value={values.focusArea}
            onChange={(event) => updateValue("focusArea", event.target.value)}
            className={getFieldClassName(Boolean(errors.focusArea))}
          >
            <option>Finding the right rental</option>
            <option>Listing as an owner</option>
            <option>Partnerships</option>
            <option>Trust and safety</option>
            <option>Accessibility support</option>
          </select>
          {errors.focusArea ? (
            <span className="text-xs text-rose-700">{errors.focusArea}</span>
          ) : null}
        </label>
      </div>

      <label className="mt-5 grid gap-2 text-sm text-slate-600">
        Project notes
        <textarea
          rows={6}
          value={values.projectNotes}
          onChange={(event) => updateValue("projectNotes", event.target.value)}
          placeholder="Tell us what you are looking for, the timing, and anything the team should know."
          className={[
            "rounded-[1.5rem] border bg-white/90 px-4 py-3 text-slate-900 outline-none transition",
            errors.projectNotes
              ? "border-rose-300 focus:border-rose-400"
              : "border-slate-200 focus:border-violet-300 focus:bg-white",
          ].join(" ")}
        />
        {errors.projectNotes ? (
          <span className="text-xs text-rose-700">{errors.projectNotes}</span>
        ) : null}
      </label>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-xs leading-6 text-slate-500">
          This contact flow currently stores submissions in the browser only, so
          we can validate the experience before wiring it to backend delivery.
        </p>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-y-0"
        >
          {isSubmitting ? "Sending inquiry..." : "Send inquiry"}
        </button>
      </div>

      {isSubmitted ? (
        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          Thanks. Your inquiry has been captured locally and is ready for
          backend integration next.
        </div>
      ) : null}
    </form>
  );
}
