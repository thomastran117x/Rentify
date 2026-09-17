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

export function canPayBooking(
  status: string,
  state: ConversionState & { holdExpiresAt?: string },
  now: number = Date.now(),
): boolean {
  return (
    ["awaiting_payment", "payment_failed"].includes(status) &&
    !isConverted(state) &&
    isHoldActive(state.holdExpiresAt, now)
  );
}

export function canConvertBooking(
  status: string,
  state: ConversionState,
): boolean {
  return status === "paid" && !isConverted(state);
}
