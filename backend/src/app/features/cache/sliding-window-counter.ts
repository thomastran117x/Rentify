/** The cache operation the counter needs. */
export interface SlidingWindowCache {
  eval<TResult>(
    script: string,
    keys?: string[],
    args?: string[],
  ): Promise<TResult>;
}

/**
 * Drops members older than the window, adds or refreshes this one, and
 * returns how many remain, in one step. Members are a sorted set scored by
 * time, so the same member twice counts once: a distinct count when members
 * are, say, identifier hashes, and an event count when they are event ids.
 */
export const SLIDING_WINDOW_COUNT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
redis.call("ZREMRANGEBYSCORE", key, 0, now - window_ms)
redis.call("ZADD", key, now, ARGV[3])
redis.call("PEXPIRE", key, window_ms)
return redis.call("ZCARD", key)
`;

/**
 * Records `member` in the window at `key` and returns the window's member
 * count. Unlike the rate limiter's window, which refuses a request at the
 * limit without recording it, this always records: it counts signals rather
 * than admitting requests.
 */
export async function recordInSlidingWindow(
  cache: SlidingWindowCache,
  key: string,
  member: string,
  windowSeconds: number,
  nowMs: number = Date.now(),
): Promise<number> {
  const count = await cache.eval<number>(
    SLIDING_WINDOW_COUNT_SCRIPT,
    [key],
    [String(nowMs), String(windowSeconds * 1000), member],
  );

  return Number(count);
}

/**
 * Counts the members still inside the window without recording one. The
 * lower bound is exclusive, matching what the count script trims.
 */
export const SLIDING_WINDOW_PEEK_SCRIPT = `
local since = tonumber(ARGV[1]) - tonumber(ARGV[2])
return redis.call("ZCOUNT", KEYS[1], "(" .. since, "+inf")
`;

/** How many members the window at `key` holds right now. */
export async function countInSlidingWindow(
  cache: SlidingWindowCache,
  key: string,
  windowSeconds: number,
  nowMs: number = Date.now(),
): Promise<number> {
  const count = await cache.eval<number>(
    SLIDING_WINDOW_PEEK_SCRIPT,
    [key],
    [String(nowMs), String(windowSeconds * 1000)],
  );

  return Number(count);
}
