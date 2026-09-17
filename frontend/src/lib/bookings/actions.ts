// Client-side mirrors of the backend eligibility rules for booking decisions,
// payment, and conversion. The API stays authoritative; these only decide
// which actions are offered.

interface ConversionState {
  convertedAt?: string;
  rentingId?: string;
}

function isConverted(state: ConversionState): boolean {
  return Boolean(state.convertedAt || state.rentingId);
}

function isHoldActive(holdExpiresAt: string | undefined, now: number): boolean {
  if (!holdExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(holdExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function canDecideBooking(
  status: string,
  holdExpiresAt: string | undefined,
  now: number = Date.now(),
): boolean {
  return status === "pending" && isHoldActive(holdExpiresAt, now);
}

// payment_processing stays payable: a renter who abandoned an unapproved
// checkout can start over, and the API replaces the old order.
const PAYABLE_BOOKING_STATUSES = [
  "awaiting_payment",
  "payment_processing",
  "payment_failed",
];

export function canPayBooking(
  status: string,
  state: ConversionState & { holdExpiresAt?: string },
  now: number = Date.now(),
): boolean {
  return (
    PAYABLE_BOOKING_STATUSES.includes(status) &&
    !isConverted(state) &&
    isHoldActive(state.holdExpiresAt, now)
  );
}

export function payActionLabel(status: string): string {
  if (status === "payment_failed") {
    return "Retry payment";
  }

  return status === "payment_processing" ? "Continue checkout" : "Pay now";
}

export function checkoutPath(bookingRequestId: string): string {
  return `/bookings/${encodeURIComponent(bookingRequestId)}/checkout`;
}

export function canConvertBooking(
  status: string,
  state: ConversionState,
): boolean {
  return status === "paid" && !isConverted(state);
}
