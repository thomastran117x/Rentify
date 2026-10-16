import { randomBytes } from "node:crypto";

/** The cache operations a ticket store needs. */
export interface SocketTicketCache {
  setJson(key: string, value: unknown, ttlInSeconds?: number): Promise<void>;
  getDeleteJson<T>(key: string): Promise<T | null>;
}

/** A minted ticket: the secret, and how long it is good for. */
export interface IssuedSocketTicket {
  /** Never returned to the browser: it is delivered as an HttpOnly cookie. */
  ticket: string;
  expiresInSeconds: number;
}

/**
 * Issues and redeems the single-use tickets that open a Socket.IO connection.
 *
 * A browser cannot set an `Authorization` header on the handshake, so the
 * client exchanges its bearer token for a ticket over REST, and the server
 * returns it as an HttpOnly cookie scoped to the socket path. The ticket maps
 * to whatever identity the gateway needs. It is redeemed by reading and
 * deleting it in one operation, so two upgrades racing with the same ticket
 * cannot both be admitted, and a ticket leaked from a log cannot be replayed.
 *
 * Only the ticket itself is shared here. Whether the identity it carries may
 * still connect, such as whether its session is still signed in, is the
 * gateway's to check after redeeming it.
 */
export class SocketTicketStore<TIdentity> {
  constructor(
    private readonly cache: SocketTicketCache,
    private readonly options: { keyPrefix: string; ttlSeconds: number },
  ) {}

  async issue(identity: TIdentity): Promise<IssuedSocketTicket> {
    const ticket = randomBytes(32).toString("base64url");

    await this.cache.setJson(
      this.key(ticket),
      identity,
      this.options.ttlSeconds,
    );

    return { ticket, expiresInSeconds: this.options.ttlSeconds };
  }

  /** The ticket's identity, once; null for a missing, spent, or unknown one. */
  async redeem(ticket: string): Promise<TIdentity | null> {
    if (!ticket) {
      return null;
    }

    return this.cache.getDeleteJson<TIdentity>(this.key(ticket));
  }

  private key(ticket: string): string {
    return `${this.options.keyPrefix}:${ticket}`;
  }
}
