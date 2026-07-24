"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarClock, Zap } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { FieldErrorMessage, FormErrorMessage } from "@/components/errors";
import { ApiClientError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  bookingRequestsApi,
  type BookingQuoteFailureReason,
  type BookingQuoteResult,
} from "@/lib/booking-requests/api";
import type { BookingRequestRecord } from "@/lib/bookings/types";
import type { PublicPostingDetail } from "@/lib/postings/public";
import { formatPostingPrice } from "@/lib/postings/public-format";

interface BookingRequestPanelProps {
  posting: PublicPostingDetail;
}

interface BookingFormValues {
  startAt: string;
  endAt: string;
  guestCount: string;
  note: string;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber: string;
}

type BookingFormErrors = Partial<Record<keyof BookingFormValues, string>>;

const initialValues: BookingFormValues = {
  startAt: "",
  endAt: "",
  guestCount: "1",
  note: "",
  contactName: "",
  contactEmail: "",
  contactPhoneNumber: "",
};

const FAILURE_REASON_MESSAGES: Record<
  BookingQuoteFailureReason["code"],
  string
> = {
  own_posting: "You can't book a posting owned by your own organization.",
  posting_unavailable: "This posting isn't accepting bookings right now.",
  invalid_dates: "Choose a valid start and end date.",
  max_duration_exceeded:
    "The selected dates exceed the maximum booking length.",
  min_duration_not_met: "The selected dates are shorter than the minimum stay.",
  advance_notice_not_met:
    "This posting needs more advance notice before the start date.",
  invalid_guest_count: "Enter a valid number of guests.",
  guest_count_exceeded: "That's more guests than this posting allows.",
  note_too_long: "Shorten your note and try again.",
  renting_overlap: "Those dates overlap an existing booking.",
  availability_block_overlap: "The owner has blocked part of those dates.",
  active_request_limit_exceeded:
    "You already have the maximum number of active requests for this posting.",
};

function toIsoDate(dateValue: string): string {
  // Date inputs yield YYYY-MM-DD; the API expects an ISO datetime.
  return `${dateValue}T00:00:00.000Z`;
}

function describeFailure(reason: BookingQuoteFailureReason): string {
  return (
    FAILURE_REASON_MESSAGES[reason.code] ??
    reason.message ??
    "These dates can't be booked."
  );
}

function getFieldClassName(hasError: boolean): string {
  return [
    "rounded-2xl border bg-white/90 dark:bg-slate-900/90 px-4 py-3 text-slate-900 dark:text-white outline-none transition",
    hasError
      ? "border-rose-300 dark:border-rose-800 focus:border-rose-400"
      : "border-slate-200 dark:border-slate-800 focus:border-violet-300 focus:bg-white dark:focus:bg-slate-900",
  ].join(" ");
}

function validate(values: BookingFormValues): BookingFormErrors {
  const errors: BookingFormErrors = {};

  if (!values.startAt) {
    errors.startAt = "Choose a start date.";
  }

  if (!values.endAt) {
    errors.endAt = "Choose an end date.";
  } else if (values.startAt && values.endAt <= values.startAt) {
    errors.endAt = "The end date must be after the start date.";
  }

  const guestCount = Number(values.guestCount);
  if (!Number.isInteger(guestCount) || guestCount < 1) {
    errors.guestCount = "Enter at least one guest.";
  }

  if (!values.contactName.trim()) {
    errors.contactName = "Enter a contact name.";
  }

  if (!values.contactEmail.trim()) {
    errors.contactEmail = "Enter a contact email.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail)) {
    errors.contactEmail = "Use a valid email address.";
  }

  return errors;
}

export function BookingRequestPanel({ posting }: BookingRequestPanelProps) {
  const { status, session } = useAuth();
  const isAuthenticated = status === "authenticated" && Boolean(session);

  const [values, setValues] = useState<BookingFormValues>(initialValues);
  const [errors, setErrors] = useState<BookingFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingRequestRecord | null>(
    null,
  );

  const [quote, setQuote] = useState<BookingQuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Prefill contact details from the signed-in account. Depend on the primitive
  // values (not the session object) so a fresh session reference can't loop the
  // effect, and coalesce to "" so a partial session never sets an undefined value.
  const sessionUsername = isAuthenticated ? session?.user.username : undefined;
  const sessionEmail = isAuthenticated ? session?.user.email : undefined;

  useEffect(() => {
    if (!sessionUsername && !sessionEmail) {
      return;
    }

    setValues((current) => ({
      ...current,
      contactName: current.contactName.trim() || sessionUsername || "",
      contactEmail: current.contactEmail.trim() || sessionEmail || "",
    }));
  }, [sessionUsername, sessionEmail]);

  const datesReady = useMemo(
    () =>
      Boolean(values.startAt && values.endAt && values.endAt > values.startAt),
    [values.startAt, values.endAt],
  );

  // Fetch a live quote (debounced) whenever the dates or guest count change.
  useEffect(() => {
    if (!isAuthenticated || !datesReady) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    let active = true;
    setQuoteLoading(true);
    setQuoteError(null);

    const timer = setTimeout(() => {
      const guestCount = Number(values.guestCount);
      void bookingRequestsApi
        .quote(posting.id, {
          startAt: toIsoDate(values.startAt),
          endAt: toIsoDate(values.endAt),
          guestCount:
            Number.isInteger(guestCount) && guestCount >= 1
              ? guestCount
              : undefined,
          note: values.note.trim() || null,
        })
        .then((result) => {
          if (active) {
            setQuote(result);
          }
        })
        .catch((error) => {
          if (active) {
            setQuote(null);
            setQuoteError(
              getApiErrorMessage(error, {
                action: "check availability for these dates",
                fallback:
                  "We couldn't check availability right now. Please try again.",
              }),
            );
          }
        })
        .finally(() => {
          if (active) {
            setQuoteLoading(false);
          }
        });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    isAuthenticated,
    datesReady,
    posting.id,
    values.startAt,
    values.endAt,
    values.guestCount,
    values.note,
  ]);

  function updateValue<K extends keyof BookingFormValues>(
    key: K,
    value: BookingFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validate(values);
    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const guestCount = Number(values.guestCount);
      const result = await bookingRequestsApi.create(posting.id, {
        startAt: toIsoDate(values.startAt),
        endAt: toIsoDate(values.endAt),
        guestCount: Number.isInteger(guestCount) ? guestCount : undefined,
        note: values.note.trim() || null,
        contactName: values.contactName.trim(),
        contactEmail: values.contactEmail.trim().toLowerCase(),
        contactPhoneNumber: values.contactPhoneNumber.trim() || null,
      });

      setConfirmation(result);
    } catch (error) {
      if (error instanceof ApiClientError) {
        const details = error.details;
        if (details && typeof details === "object") {
          const fieldErrors: BookingFormErrors = {};
          for (const key of [
            "startAt",
            "endAt",
            "guestCount",
            "note",
            "contactName",
            "contactEmail",
            "contactPhoneNumber",
          ] as const) {
            const value = (details as Record<string, unknown>)[key];
            if (Array.isArray(value) && typeof value[0] === "string") {
              fieldErrors[key] = value[0];
            }
          }
          if (Object.values(fieldErrors).some(Boolean)) {
            setErrors((current) => ({ ...current, ...fieldErrors }));
          }
        }
      }

      setSubmitError(
        getApiErrorMessage(error, {
          action: "submit your booking request",
          fallback:
            "We couldn't submit your booking request right now. Please try again.",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (confirmation) {
    const instantlyApproved =
      confirmation.status === "awaiting_payment" ||
      confirmation.autoApproved === true;

    return (
      <section
        className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl shadow-slate-950/5 sm:p-7"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              instantlyApproved
                ? "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
            ].join(" ")}
            aria-hidden="true"
          >
            {instantlyApproved ? (
              <Zap className="h-5 w-5" />
            ) : (
              <CalendarClock className="h-5 w-5" />
            )}
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
              {instantlyApproved
                ? "Your booking was instantly approved"
                : "Your request is pending approval"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {instantlyApproved
                ? "This posting offers Instant Book, so no owner approval was needed. Head to your bookings to complete payment and lock in the dates."
                : "The owner has up to 24 hours to review your request. We'll hold your dates until then — track the status from your bookings."}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 rounded-[1.4rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-4 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Dates
            </dt>
            <dd className="mt-1 text-slate-900 dark:text-white">
              {confirmation.durationDays} day
              {confirmation.durationDays === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Estimated total
            </dt>
            <dd className="mt-1 text-slate-900 dark:text-white">
              {formatPostingPrice(
                confirmation.estimatedTotal,
                confirmation.pricingCurrency,
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/bookings"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-violet-600 px-6 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700"
          >
            {instantlyApproved ? "Complete payment" : "View my bookings"}
          </Link>
          <button
            type="button"
            onClick={() => {
              setConfirmation(null);
              setValues((current) => ({
                ...current,
                startAt: "",
                endAt: "",
                note: "",
              }));
              setQuote(null);
            }}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 dark:border-slate-700 px-5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Book different dates
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl shadow-slate-950/5 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
          Request to book
        </h2>
        <span className="text-lg font-semibold text-slate-950 dark:text-white">
          {formatPostingPrice(
            posting.pricing.daily.amount,
            posting.pricing.currency,
          )}
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            {" "}
            / day
          </span>
        </span>
      </div>

      {posting.instantBooking ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-300">
          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          Instant Book — approved immediately, no waiting on the owner.
        </p>
      ) : null}

      {!isAuthenticated ? (
        <div className="mt-5 rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-5 py-6 text-sm leading-6 text-slate-600 dark:text-slate-300">
          <p>Sign in to request this booking and see live availability.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-violet-600 px-6 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700"
          >
            Sign in to book
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-5 grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
              Start date
              <input
                type="date"
                value={values.startAt}
                onChange={(event) => updateValue("startAt", event.target.value)}
                aria-invalid={Boolean(errors.startAt)}
                aria-describedby={
                  errors.startAt ? "booking-start-error" : undefined
                }
                className={getFieldClassName(Boolean(errors.startAt))}
              />
              <FieldErrorMessage
                id="booking-start-error"
                message={errors.startAt}
              />
            </label>

            <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
              End date
              <input
                type="date"
                value={values.endAt}
                onChange={(event) => updateValue("endAt", event.target.value)}
                aria-invalid={Boolean(errors.endAt)}
                aria-describedby={
                  errors.endAt ? "booking-end-error" : undefined
                }
                className={getFieldClassName(Boolean(errors.endAt))}
              />
              <FieldErrorMessage
                id="booking-end-error"
                message={errors.endAt}
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
            Guests
            <input
              type="number"
              min={1}
              value={values.guestCount}
              onChange={(event) =>
                updateValue("guestCount", event.target.value)
              }
              aria-invalid={Boolean(errors.guestCount)}
              aria-describedby={
                errors.guestCount ? "booking-guests-error" : undefined
              }
              className={getFieldClassName(Boolean(errors.guestCount))}
            />
            <FieldErrorMessage
              id="booking-guests-error"
              message={errors.guestCount}
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
              Contact name
              <input
                type="text"
                value={values.contactName}
                onChange={(event) =>
                  updateValue("contactName", event.target.value)
                }
                aria-invalid={Boolean(errors.contactName)}
                aria-describedby={
                  errors.contactName ? "booking-name-error" : undefined
                }
                className={getFieldClassName(Boolean(errors.contactName))}
              />
              <FieldErrorMessage
                id="booking-name-error"
                message={errors.contactName}
              />
            </label>

            <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
              Contact email
              <input
                type="email"
                value={values.contactEmail}
                onChange={(event) =>
                  updateValue("contactEmail", event.target.value)
                }
                aria-invalid={Boolean(errors.contactEmail)}
                aria-describedby={
                  errors.contactEmail ? "booking-email-error" : undefined
                }
                className={getFieldClassName(Boolean(errors.contactEmail))}
              />
              <FieldErrorMessage
                id="booking-email-error"
                message={errors.contactEmail}
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
            Contact phone (optional)
            <input
              type="tel"
              value={values.contactPhoneNumber}
              onChange={(event) =>
                updateValue("contactPhoneNumber", event.target.value)
              }
              className={getFieldClassName(false)}
            />
          </label>

          <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
            Note to the owner (optional)
            <textarea
              rows={3}
              value={values.note}
              onChange={(event) => updateValue("note", event.target.value)}
              placeholder="Share anything the owner should know about your booking."
              className="rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 px-4 py-3 text-slate-900 dark:text-white outline-none transition focus:border-violet-300"
            />
          </label>

          {datesReady ? (
            <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-4 py-4 text-sm">
              {quoteLoading ? (
                <p className="text-slate-500 dark:text-slate-400">
                  Checking availability…
                </p>
              ) : quoteError ? (
                <p className="text-rose-600 dark:text-rose-400">{quoteError}</p>
              ) : quote ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">
                      {quote.durationDays ?? 0} day
                      {quote.durationDays === 1 ? "" : "s"}
                    </span>
                    <span className="font-semibold text-slate-950 dark:text-white">
                      {quote.estimatedTotal != null
                        ? formatPostingPrice(
                            quote.estimatedTotal,
                            quote.pricingCurrency,
                          )
                        : "—"}
                    </span>
                  </div>
                  {quote.instantBooking ? (
                    <p className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                      Instant Book — approved immediately.
                    </p>
                  ) : null}
                  {quote.failureReasons.length > 0 ? (
                    <ul className="mt-1 grid gap-1 text-rose-600 dark:text-rose-400">
                      {quote.failureReasons.map((reason) => (
                        <li key={reason.code}>{describeFailure(reason)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {submitError ? (
            <FormErrorMessage
              title="Couldn't submit your booking request"
              message={submitError}
            />
          ) : null}

          <button
            type="submit"
            disabled={
              isSubmitting ||
              quoteLoading ||
              (quote != null && quote.failureReasons.length > 0)
            }
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-violet-600 px-6 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
          >
            {isSubmitting
              ? "Submitting…"
              : posting.instantBooking
                ? "Book instantly"
                : "Request to book"}
          </button>
        </form>
      )}
    </section>
  );
}
