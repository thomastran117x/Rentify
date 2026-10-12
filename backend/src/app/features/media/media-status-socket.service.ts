import { randomBytes } from "node:crypto";
import type { Uuid } from "@/configuration/validation/uuid";
import type { TokenService } from "@/features/auth/token/token.service";
import type { CacheService } from "@/features/cache/cache.service";
import {
  MEDIA_STATUS_SOCKET_TICKET_TTL_SECONDS,
  type MediaStatusSocketIdentity,
  type MediaStatusSocketSession,
  type MediaStatusSocketTicket,
} from "@/features/media/media.model";

/**
 * Issues and redeems the tickets that open a media status socket. A socket
 * only ever hears about its own user's uploads, so the ticket needs no access
 * check beyond the session that minted it.
 */
export class MediaStatusSocketService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly tokenService: TokenService,
  ) {}

  async createSocketTicket(
    userId: Uuid,
    session: MediaStatusSocketSession,
  ): Promise<MediaStatusSocketTicket> {
    const ticket = randomBytes(32).toString("base64url");
    const identity: MediaStatusSocketIdentity = { userId, ...session };

    await this.cacheService.setJson(
      this.socketTicketKey(ticket),
      identity,
      MEDIA_STATUS_SOCKET_TICKET_TTL_SECONDS,
    );

    return { ticket, expiresInSeconds: MEDIA_STATUS_SOCKET_TICKET_TTL_SECONDS };
  }

  /**
   * Redeems a ticket exactly once, reading and removing it in one operation,
   * so two upgrades racing with the same ticket cannot both be admitted. The
   * session is checked again rather than trusted: it can be signed out between
   * minting the ticket and the upgrade landing.
   */
  async redeemSocketTicket(
    ticket: string,
  ): Promise<MediaStatusSocketIdentity | null> {
    if (!ticket) {
      return null;
    }

    const identity =
      await this.cacheService.getDeleteJson<MediaStatusSocketIdentity>(
        this.socketTicketKey(ticket),
      );

    if (!identity) {
      return null;
    }

    try {
      await this.assertSocketSessionValid(identity);
    } catch {
      return null;
    }

    return identity;
  }

  /** Throws once the session behind an open socket can no longer be used. */
  async assertSocketSessionValid(
    identity: MediaStatusSocketIdentity,
  ): Promise<void> {
    await this.tokenService.assertSessionIsUsable(
      identity.userId,
      identity.sessionId,
      identity.tokenVersion,
    );
  }

  private socketTicketKey(ticket: string): string {
    return `media-status:ws-ticket:${ticket}`;
  }
}
