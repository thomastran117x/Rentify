import {
  SocketTicketStore,
  type SocketTicketCache,
} from "@/configuration/realtime/socket-tickets";
import type { Uuid } from "@/configuration/validation/uuid";
import type { TokenService } from "@/features/auth/token/token.service";
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
  private readonly tickets: SocketTicketStore<MediaStatusSocketIdentity>;

  constructor(
    cache: SocketTicketCache,
    private readonly tokenService: Pick<TokenService, "assertSessionIsUsable">,
  ) {
    this.tickets = new SocketTicketStore(cache, {
      keyPrefix: "media-status:ws-ticket",
      ttlSeconds: MEDIA_STATUS_SOCKET_TICKET_TTL_SECONDS,
    });
  }

  createSocketTicket(
    userId: Uuid,
    session: MediaStatusSocketSession,
  ): Promise<MediaStatusSocketTicket> {
    return this.tickets.issue({ userId, ...session });
  }

  /**
   * Redeems a ticket exactly once. The session is checked again rather than
   * trusted: it can be signed out between minting the ticket and the upgrade
   * landing.
   */
  async redeemSocketTicket(
    ticket: string,
  ): Promise<MediaStatusSocketIdentity | null> {
    const identity = await this.tickets.redeem(ticket);

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
}
