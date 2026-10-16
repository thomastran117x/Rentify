/**
 * What `uploadImage` in `frontend/src/lib/media/api.ts` waits between status
 * checks, so `bench:media-latency --notify poll|push` models what browsers do.
 * They are copies: the frontend is built and shipped on its own, and cannot be
 * imported from here. A backend test reads the frontend source and fails when
 * these drift from it.
 */

/** `DEFAULT_POLL_DELAYS_MS`: the checks while no status socket listens. */
export const BROWSER_POLL_DELAYS_MS = [500, 750, 1000, 1500, 2000];

/** `PUSH_FALLBACK_DELAYS_MS`: the checks behind a listening socket. */
export const BROWSER_PUSH_FALLBACK_DELAYS_MS = [1000, 2000, 3000];
