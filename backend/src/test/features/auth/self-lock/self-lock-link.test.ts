import type { AuthUserRecord } from "@/features/auth/auth.model";
import { issueSelfLockLinkToken } from "@/features/auth/self-lock/self-lock-link";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 379201);
const EVENT_ID = testUuid(9100, 379201);
const BCRYPT_HASH =
  "$2b$12$1M7NQyWNh5v3NFg4cTQdUeVUI5BvR9f0vAOVeI3E1FQfQ0rFJz0Vy";

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_ID,
    email: "user@example.com",
    passwordHash: BCRYPT_HASH,
    emailVerified: true,
    ...overrides,
  } as AuthUserRecord;
}

function createLogger() {
  return { error: jest.fn() } as any;
}

describe("issueSelfLockLinkToken", () => {
  it("issues a token naming the user and the source event", async () => {
    const store = { issue: jest.fn(async () => "lock-token") };

    await expect(
      issueSelfLockLinkToken(store, createUser(), EVENT_ID, createLogger()),
    ).resolves.toBe("lock-token");
    expect(store.issue).toHaveBeenCalledWith({
      userId: USER_ID,
      sourceEventId: EVENT_ID,
    });
  });

  it.each([
    ["has no local password", { passwordHash: null }],
    ["has an unverified email", { emailVerified: false }],
  ])("issues nothing for an account that %s", async (_label, overrides) => {
    const store = { issue: jest.fn(async () => "lock-token") };

    await expect(
      issueSelfLockLinkToken(
        store,
        createUser(overrides as Partial<AuthUserRecord>),
        EVENT_ID,
        createLogger(),
      ),
    ).resolves.toBeUndefined();
    expect(store.issue).not.toHaveBeenCalled();
  });

  it("logs and gives up the link when the store fails", async () => {
    const store = {
      issue: jest.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const logger = createLogger();

    await expect(
      issueSelfLockLinkToken(store, createUser(), EVENT_ID, logger),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to issue a self-lock token.",
      expect.objectContaining({ userId: USER_ID }),
    );
  });
});
