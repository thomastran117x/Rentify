import type { Response } from "express";

/**
 * Runs a callback once the response has been fully written, or once the
 * connection has gone away.
 *
 * Hono middleware could `await next()` and do cleanup in a `finally`. Express's
 * `next()` returns immediately, so anything that has to observe the *outcome*
 * of a request — reading the final status, disposing a request-scoped resource,
 * clearing a timer — has to hang off the response's lifecycle events instead.
 *
 * `finish` fires when the response was written; `close` fires when the socket
 * closed, including on an aborted request where `finish` never comes. Both are
 * registered and the callback is guarded so it runs exactly once.
 *
 * Note that this fires *after* the headers have gone out, so callbacks must not
 * try to set headers. Work that only writes headers belongs before `next()`.
 */
export function runAfterResponse(
  response: Response,
  callback: () => void | Promise<void>,
): void {
  let hasRun = false;

  const run = (): void => {
    if (hasRun) {
      return;
    }

    hasRun = true;
    response.removeListener("finish", run);
    response.removeListener("close", run);

    try {
      const result = callback();

      if (result instanceof Promise) {
        // Nothing can consume a rejection at this point in the request, so
        // swallow it rather than taking the process down with an unhandled
        // rejection.
        result.catch(() => undefined);
      }
    } catch {
      // As above: the response is already gone, so there is nowhere to report.
    }
  };

  response.on("finish", run);
  response.on("close", run);
}
