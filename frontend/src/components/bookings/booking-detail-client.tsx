"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { BookingMessagesPanel } from "@/components/bookings/booking-messages-panel";
import { ApiError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { bookingsApi } from "@/lib/bookings/api";
import type { BookingRequestRecord } from "@/lib/bookings/types";
import {
  formatDateRange,
  formatMoney,
  humanizeStatus,
  statusClasses,
} from "@/lib/rentings/format";

interface BookingDetailClientProps {
  bookingRequestId: string;
}

function DetailMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-8 text-center shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-950 dark:text-white">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {description}
        </p>
        <Link
          href="/bookings"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-300 hover:text-violet-700 dark:border-slate-700 dark:text-slate-200"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to bookings
        </Link>
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-950 dark:text-white">
        {icon}
        <h2 className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function BookingDetailClient({
  bookingRequestId,
}: BookingDetailClientProps) {
  const router = useRouter();
  const { status, session } = useAuth();

  const [booking, setBooking] = useState<BookingRequestRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated" || !session) {
      return;
    }

    let active = true;

    async function loadBooking() {
      setLoading(true);

      try {
        const record = await bookingsApi.getBookingById(bookingRequestId);

        if (!active) {
          return;
        }

        startTransition(() => {
          setBooking(record);
        });
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else if (error instanceof ApiError && error.status === 403) {
          setForbidden(true);
        } else {
          setErrorText(
            getApiErrorMessage(error, {
              action: "load booking",
              fallback: "We could not load this booking request.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadBooking();

    return () => {
      active = false;
    };
  }, [bookingRequestId, session, status]);

  if (status === "loading" || (loading && !notFound && !forbidden)) {
    return (
      <DetailMessage
        title="Loading booking"
        description="Fetching this booking request and its conversation."
      />
    );
  }

  if (notFound) {
    return (
      <DetailMessage
        title="Booking not found"
        description="This booking request does not exist or has been removed."
      />
    );
  }

  if (forbidden) {
    return (
      <DetailMessage
        title="You do not have access"
        description="Only the renter and the owning organization can view this booking request."
      />
    );
  }

  if (errorText || !booking || !session) {
    return (
      <DetailMessage
        title="Something went wrong"
        description={errorText ?? "We could not load this booking request."}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/bookings"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-violet-700 dark:text-slate-300"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to bookings
      </Link>

      <div className="mt-6 flex flex-col gap-6">
        <Panel
          icon={<CalendarDays aria-hidden="true" className="h-5 w-5" />}
          title={booking.posting.name}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(booking.status)}`}
            >
              {humanizeStatus(booking.status)}
            </span>
            <span>{formatDateRange(booking.startAt, booking.endAt)}</span>
            <span>
              {formatMoney(booking.estimatedTotal, booking.pricingCurrency)}
            </span>
          </div>
          {booking.note ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {booking.note}
            </p>
          ) : null}
        </Panel>

        <BookingMessagesPanel
          bookingRequestId={booking.id}
          currentUserId={session.user.id}
        />
      </div>
    </div>
  );
}
