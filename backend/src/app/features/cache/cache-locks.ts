import ConflictError from "@/errors/http/conflict.error";
import type { CacheService } from "@/features/cache/cache.service";

export const FLOW_LOCK_TTL_MS = 15_000;

export const flowLockKeys = {
  bookingRequestDecision: (bookingRequestId: string) =>
    `booking-request:${bookingRequestId}:decision`,
  bookingRequestState: (bookingRequestId: string) =>
    `booking-request:${bookingRequestId}:state`,
  bookingRequestConvert: (bookingRequestId: string) =>
    `booking-request:${bookingRequestId}:convert`,
  bookingRequestCap: (postingId: string, renterId: string) =>
    `booking-request-cap:${postingId}:${renterId}`,
  rentingState: (rentingId: string) => `renting:${rentingId}:state`,
  postingBookingWindow: (postingId: string) => `posting:${postingId}:booking-window`,
};

export async function withFlowLock<T>(
  cacheService: CacheService,
  key: string,
  callback: () => Promise<T>,
  conflictMessage = "Another request is already modifying this booking flow. Please retry.",
): Promise<T> {
  const lock = await cacheService.acquireLock(key, FLOW_LOCK_TTL_MS);

  if (!lock) {
    throw new ConflictError(conflictMessage);
  }

  try {
    return await callback();
  } finally {
    await lock.release();
  }
}

export async function withFlowLocks<T>(
  cacheService: CacheService,
  keys: string[],
  callback: () => Promise<T>,
  conflictMessage?: string,
): Promise<T> {
  const [currentKey, ...remainingKeys] = keys;

  if (!currentKey) {
    return callback();
  }

  return withFlowLock(
    cacheService,
    currentKey,
    () => withFlowLocks(cacheService, remainingKeys, callback, conflictMessage),
    conflictMessage,
  );
}
