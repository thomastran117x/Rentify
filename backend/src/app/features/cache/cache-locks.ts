import ConflictError from "@/errors/http/conflict.error";
import type { CacheService } from "@/features/cache/cache.service";
import type { Uuid } from "@/configuration/validation/uuid";

export const FLOW_LOCK_TTL_MS = 15_000;

export const flowLockKeys = {
  bookingRequestDecision: (bookingRequestId: Uuid) =>
    `booking-request:${bookingRequestId}:decision`,
  bookingRequestState: (bookingRequestId: Uuid) =>
    `booking-request:${bookingRequestId}:state`,
  bookingRequestConvert: (bookingRequestId: Uuid) =>
    `booking-request:${bookingRequestId}:convert`,
  bookingRequestCap: (postingId: Uuid, renterId: Uuid) =>
    `booking-request-cap:${postingId}:${renterId}`,
  rentingState: (rentingId: Uuid) => `renting:${rentingId}:state`,
  postingBookingWindow: (postingId: Uuid) =>
    `posting:${postingId}:booking-window`,
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
