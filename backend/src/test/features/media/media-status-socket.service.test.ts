import { asUuid } from "@/configuration/validation/uuid";
import type { TokenService } from "@/features/auth/token/token.service";
import type { CacheService } from "@/features/cache/cache.service";
import { MediaStatusSocketService } from "@/features/media/media-status-socket.service";
import { testUuid } from "../../support/uuid";

const USER_ID = asUuid(testUuid(9000, 994410));
const SESSION = { sessionId: "session-1", tokenVersion: 2 };

/** A cache that keeps values in memory, with the TTL it was given. */
function createCache() {
  const entries = new Map<string, { value: unknown; ttlSeconds: number }>();

  return {
    entries,
    cache: {
      setJson: jest.fn(async (key: string, value: unknown, ttl: number) => {
        entries.set(key, { value, ttlSeconds: ttl });
      }),
      getDeleteJson: jest.fn(async (key: string) => {
        const entry = entries.get(key);
        entries.delete(key);
        return entry?.value ?? null;
      }),
    },
  };
}

function createService(assertSessionIsUsable = jest.fn(async () => {})) {
  const { cache, entries } = createCache();
  const service = new MediaStatusSocketService(
    cache as unknown as CacheService,
    { assertSessionIsUsable } as unknown as TokenService,
  );

  return { service, entries, assertSessionIsUsable };
}

describe("MediaStatusSocketService", () => {
  it("mints a random, short-lived ticket carrying the user and session", async () => {
    const { service, entries } = createService();

    const first = await service.createSocketTicket(USER_ID, SESSION);
    const second = await service.createSocketTicket(USER_ID, SESSION);

    expect(first.expiresInSeconds).toBe(30);
    expect(first.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.ticket).not.toBe(first.ticket);
    expect(entries.get(`media-status:ws-ticket:${first.ticket}`)).toEqual({
      value: { userId: USER_ID, ...SESSION },
      ttlSeconds: 30,
    });
  });

  it("redeems a ticket exactly once, re-checking its session", async () => {
    const { service, assertSessionIsUsable } = createService();
    const { ticket } = await service.createSocketTicket(USER_ID, SESSION);

    await expect(service.redeemSocketTicket(ticket)).resolves.toEqual({
      userId: USER_ID,
      ...SESSION,
    });
    await expect(service.redeemSocketTicket(ticket)).resolves.toBeNull();
    expect(assertSessionIsUsable).toHaveBeenCalledTimes(1);
    expect(assertSessionIsUsable).toHaveBeenCalledWith(USER_ID, "session-1", 2);
  });

  it("refuses a missing or unknown ticket", async () => {
    const { service } = createService();

    await expect(service.redeemSocketTicket("")).resolves.toBeNull();
    await expect(service.redeemSocketTicket("unknown")).resolves.toBeNull();
  });

  it("refuses a ticket whose session was signed out after it was minted", async () => {
    const { service } = createService(
      jest.fn(async () => {
        throw new Error("Session has been revoked.");
      }),
    );
    const { ticket } = await service.createSocketTicket(USER_ID, SESSION);

    await expect(service.redeemSocketTicket(ticket)).resolves.toBeNull();
  });
});
