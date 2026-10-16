import { io, type Socket } from "socket.io-client";
import { authenticatedJson } from "@/lib/api/client";
import { readStoredSession } from "@/lib/auth/storage";
import { resolveApiBaseUrl } from "@/lib/env";

/** Path the server mounts the media status socket on, and the ticket's scope. */
const SOCKET_PATH = "/ws/media";

/** After this many consecutive failed connects the channel stops trying. */
export const MAX_CONSECUTIVE_SOCKET_FAILURES = 5;

/**
 * The handshake error a server without its Redis adapter refuses with: no push
 * can reach this page, so trying again would only spend tickets.
 */
const UNAVAILABLE = "Unavailable";

/**
 * How long the socket stays open once nothing is waiting on it, so photos
 * picked one after another share one connection instead of each opening one.
 */
export const IDLE_CLOSE_MS = 30_000;

/** The server's word that an upload finished. It carries no view. */
export interface MediaStatusPush {
  mediaId: string;
  status: "ready" | "rejected";
}

/**
 * One socket per page that tells it when the signed-in user's uploads finish.
 * A push is best effort: whoever listens keeps polling, just less often.
 */
export interface MediaStatusChannel {
  /**
   * Keeps the socket open, opening it if needed, until the returned release is
   * called. Taken when an upload starts, so the socket connects while the file
   * is still being sent.
   */
  acquire(): () => void;
  /** Calls `listener` when `mediaId` finishes. Returns the unsubscribe. */
  onStatus(
    mediaId: string,
    listener: (push: MediaStatusPush) => void,
  ): () => void;
  /** Whether a push can arrive right now: connected and in its room. */
  isListening(): boolean;
  /**
   * Calls `listener` each time the socket starts listening. A push published
   * before then was lost, so a waiting upload checks at once. Returns the
   * unsubscribe.
   */
  onListening(listener: () => void): () => void;
}

export interface MediaStatusChannelDependencies {
  mintTicket: () => Promise<unknown>;
  connect: (origin: string, options: Parameters<typeof io>[1]) => Socket;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  /** Who is signed in now, whose uploads a socket opened now would hear. */
  currentUserId: () => string | null;
}

const defaultDependencies: MediaStatusChannelDependencies = {
  // Sets the HttpOnly ticket cookie. Its body carries only the lifetime.
  mintTicket: () =>
    authenticatedJson<{ expiresInSeconds: number }>(
      "POST",
      "/media/socket-ticket",
    ),
  connect: (origin, options) => io(origin, options),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (timer) => window.clearTimeout(timer as number),
  currentUserId: () => readStoredSession()?.user?.id ?? null,
};

/** `http(s)://host/api/v1` → `http(s)://host`. Socket.IO adds the path. */
function resolveSocketOrigin(): string {
  return new URL(resolveApiBaseUrl(), window.location.origin).origin;
}

export function createMediaStatusChannel(
  dependencies: MediaStatusChannelDependencies = defaultDependencies,
): MediaStatusChannel {
  const listeners = new Map<string, Set<(push: MediaStatusPush) => void>>();
  const listeningListeners = new Set<() => void>();
  let holders = 0;
  /** The user whose ticket opened, or is opening, the current socket. */
  let socketUserId: string | null = null;
  /** Bumped on close, so an attempt still minting its ticket is abandoned. */
  let generation = 0;
  let socket: Socket | null = null;
  let connecting = false;
  let listening = false;
  let failures = 0;
  let idleTimer: unknown = null;
  let retryTimer: unknown = null;

  function cancelRetry(): void {
    if (retryTimer !== null) {
      dependencies.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function open(): void {
    if (
      typeof window === "undefined" ||
      // Nothing is waiting: a late retry must not mint a ticket for no one.
      holders === 0 ||
      socket ||
      connecting ||
      failures >= MAX_CONSECUTIVE_SOCKET_FAILURES
    ) {
      return;
    }

    void connect();
  }

  /** Spaced further apart after each failure, and only while someone waits. */
  function retry(): void {
    failures += 1;

    if (failures < MAX_CONSECUTIVE_SOCKET_FAILURES && holders > 0) {
      cancelRetry();
      retryTimer = dependencies.setTimeout(() => {
        retryTimer = null;
        open();
      }, 1_000 * failures);
    }
  }

  async function connect(): Promise<void> {
    const attempt = generation;
    connecting = true;
    socketUserId = dependencies.currentUserId();

    try {
      await dependencies.mintTicket();
    } catch {
      if (attempt === generation) {
        connecting = false;
        retry();
      }
      return;
    }

    // Closed while the ticket was minted, such as for another user's upload.
    if (attempt !== generation) {
      return;
    }

    connecting = false;

    // Everyone stopped waiting while the ticket was minted.
    if (holders === 0) {
      return;
    }

    const next = dependencies.connect(resolveSocketOrigin(), {
      path: SOCKET_PATH,
      // The ticket rides in a cookie, so the handshake carries credentials.
      withCredentials: true,
      // Each attempt needs a fresh single-use ticket, so reconnecting is
      // driven from here instead of by Socket.IO.
      reconnection: false,
      // `socket.io-client` caches Managers by origin, not path, so without
      // this a page with another gateway's socket open could reuse its
      // transport and connect to the wrong one.
      forceNew: true,
    });
    socket = next;

    // Sent once the server has put the socket in the user's room, which is
    // when pushes start to arrive and the attempt counts as a success.
    next.on("ready", () => {
      if (socket !== next) {
        return;
      }

      listening = true;
      failures = 0;

      for (const listener of [...listeningListeners]) {
        listener();
      }
    });

    next.on("media.status", (push: MediaStatusPush) => {
      for (const listener of listeners.get(push?.mediaId) ?? []) {
        listener(push);
      }
    });

    next.on("connect_error", (error: Error) => {
      if (socket !== next) {
        return;
      }

      socket = null;
      listening = false;

      if (error?.message === UNAVAILABLE) {
        // Given up at once, so uploads poll at their full rate. A later
        // upload, after the idle close, tries again.
        failures = MAX_CONSECUTIVE_SOCKET_FAILURES;
        return;
      }

      retry();
    });

    next.on("disconnect", (reason) => {
      if (socket !== next) {
        return;
      }

      socket = null;
      listening = false;

      // Closed from here on purpose; anything else is worth another attempt.
      if (reason !== "io client disconnect") {
        retry();
      }
    });
  }

  function close(): void {
    idleTimer = null;
    cancelRetry();
    generation += 1;
    connecting = false;
    socketUserId = null;
    listening = false;
    // A later upload gets a fresh set of attempts.
    failures = 0;
    const current = socket;
    socket = null;
    current?.disconnect();
  }

  return {
    acquire() {
      holders += 1;

      if (idleTimer !== null) {
        dependencies.clearTimeout(idleTimer);
        idleTimer = null;
      }

      // A socket opened for someone else, such as before a sign-out, sits in
      // their room and would never hear about this user's uploads.
      if (
        (socket || connecting) &&
        socketUserId !== dependencies.currentUserId()
      ) {
        close();
      }

      open();
      let released = false;

      return () => {
        if (released) {
          return;
        }

        released = true;
        holders -= 1;

        if (holders === 0) {
          // No one is left to retry for.
          cancelRetry();
          idleTimer = dependencies.setTimeout(close, IDLE_CLOSE_MS);
        }
      };
    },
    onStatus(mediaId, listener) {
      const forMedia = listeners.get(mediaId) ?? new Set();
      forMedia.add(listener);
      listeners.set(mediaId, forMedia);

      return () => {
        forMedia.delete(listener);

        if (forMedia.size === 0) {
          listeners.delete(mediaId);
        }
      };
    },
    isListening: () => listening,
    onListening(listener) {
      listeningListeners.add(listener);

      return () => {
        listeningListeners.delete(listener);
      };
    },
  };
}

/** The page's channel, shared by every upload on it. */
export const mediaStatusChannel = createMediaStatusChannel();
