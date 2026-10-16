import { Emitter } from "@socket.io/redis-emitter";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { redisClient } from "@/configuration/resources/redis";
import type { Uuid } from "@/configuration/validation/uuid";
import {
  MEDIA_STATUS_EVENT,
  MEDIA_STATUS_SOCKET_ADAPTER_KEY,
  mediaStatusRoom,
  type MediaStatusEvent,
} from "@/features/media/media.model";

/**
 * Tells a user's open pages that one of their uploads finished. Best effort:
 * a call never throws and never waits, and a push that is lost only means the
 * client finds out on its next poll.
 */
export interface MediaStatusPublisher {
  publish(userId: Uuid, event: MediaStatusEvent): void;
}

/** Pushes nothing. For tests, and anywhere no client is listening. */
export class NoopMediaStatusPublisher implements MediaStatusPublisher {
  publish(): void {}
}

/** The one Redis command the emitter needs. */
export interface RedisPublishClient {
  publish(channel: string, message: Buffer): Promise<unknown>;
}

/**
 * The shared Redis client, only while it is connected and ready. While Redis
 * is down the client keeps reconnecting and would queue a publish until it is
 * back, delivering a status long after anyone waited on it, so a push is
 * dropped instead.
 */
function readReadyRedisClient(): RedisPublishClient | null {
  return redisClient?.isReady ? redisClient : null;
}

/**
 * Publishes through a Socket.IO Redis emitter onto the media status gateway's
 * adapter channel, so whichever API instance holds the user's sockets delivers
 * it. This is how the processing worker, which runs no Socket.IO server,
 * reaches the browser.
 */
export class RedisMediaStatusPublisher implements MediaStatusPublisher {
  private readonly emitter: Emitter;

  constructor(
    private readonly readClient: () => RedisPublishClient | null = readReadyRedisClient,
    private readonly logger: Pick<Logger, "warn"> = loggerFactory.forClass(
      RedisMediaStatusPublisher,
      "service",
    ),
  ) {
    // The emitter fires PUBLISH without handling its promise, so it is given
    // a client whose publish cannot reject: a failure would otherwise be an
    // unhandled rejection, which ends the process.
    this.emitter = new Emitter(
      {
        publish: (channel: string, message: Buffer) => {
          const client = this.readClient();

          if (!client) {
            return Promise.resolve(0);
          }

          return client.publish(channel, message).catch((error: unknown) => {
            this.logger.warn("Failed to push a media status.", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        },
      },
      { key: MEDIA_STATUS_SOCKET_ADAPTER_KEY },
    );
  }

  publish(userId: Uuid, event: MediaStatusEvent): void {
    if (!this.readClient()) {
      return;
    }

    try {
      this.emitter.to(mediaStatusRoom(userId)).emit(MEDIA_STATUS_EVENT, event);
    } catch (error) {
      this.logger.warn("Failed to push a media status.", {
        mediaId: event.mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
