import type { PersonalAccessTokenRecord } from "@/features/auth/personal-access-token/personal-access-token.model";
import { PersonalAccessTokenService } from "@/features/auth/personal-access-token/personal-access-token.service";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { testUuid } from "../../support/uuid";

const PAT_RECORD_1_ID = testUuid(9000, 629172);
const USER_1_ID = testUuid(9000, 994257);

function createRepositoryMock() {
  return {
    create: jest.fn(),
    listByUserId: jest.fn(),
    findByIdForUser: jest.fn(),
    findByPublicId: jest.fn(),
    revoke: jest.fn(),
    touchLastUsedAt: jest.fn(),
  };
}

function createService(repository: ReturnType<typeof createRepositoryMock>) {
  return new PersonalAccessTokenService(
    repository as any,
    { recordSafely: jest.fn(async () => undefined) } as any,
    { personalAccessTokenSecret: "test-pat-secret" },
  );
}

function createTokenRecord(
  overrides: Partial<PersonalAccessTokenRecord> = {},
): PersonalAccessTokenRecord {
  return {
    id: PAT_RECORD_1_ID,
    userId: USER_1_ID,
    name: "Rentify MCP",
    publicId: "1234567890abcdef123456",
    tokenPrefix: "rpat_1234567890abcdef123456_abcdef",
    secretHash: "",
    scopes: ["mcp:read"],
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    user: {
      id: USER_1_ID,
      email: "user@example.com",
      role: "owner",
      status: "active",
    },
    ...overrides,
  };
}

function installCreateMock(
  repository: ReturnType<typeof createRepositoryMock>,
) {
  let latestInput: Record<string, unknown> | null = null;

  repository.create.mockImplementation(
    async (input: Record<string, unknown>) => {
      latestInput = input;

      return createTokenRecord({
        publicId: input.publicId as string,
        tokenPrefix: input.tokenPrefix as string,
        secretHash: input.secretHash as string,
        scopes: input.scopes as PersonalAccessTokenRecord["scopes"],
        expiresAt: (input.expiresAt as Date | undefined)?.toISOString(),
      });
    },
  );

  return {
    getLatestInput: () => latestInput,
  };
}

describe("PersonalAccessTokenService", () => {
  it("creates a token, stores only a hash, and returns the token once", async () => {
    const repository = createRepositoryMock();
    const authAuditService = { recordSafely: jest.fn(async () => undefined) };
    const service = new PersonalAccessTokenService(
      repository as any,
      authAuditService as any,
      { personalAccessTokenSecret: "test-pat-secret" },
    );
    const createState = installCreateMock(repository);

    const result = await service.create({
      userId: USER_1_ID,
      name: "Rentify MCP",
      scopes: ["mcp:read"],
      expiresInDays: 30,
      sessionId: "session-1",
      audit: { requestId: "request-1" },
    });

    expect(result.token).toMatch(/^rpat_[a-f0-9]{24}_[a-f0-9]{48}$/);
    expect(createState.getLatestInput()).toBeTruthy();
    expect(createState.getLatestInput()?.secretHash).not.toEqual(result.token);
    expect(result.tokenPrefix).toMatch(/^rpat_[a-f0-9]{24}_[a-f0-9]{6}$/);
    expect(result.scopes).toEqual(["mcp:read"]);
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "pat.created",
      outcome: "success",
      userId: USER_1_ID,
      method: "pat",
      sessionId: "session-1",
      context: { requestId: "request-1" },
      metadata: { tokenId: PAT_RECORD_1_ID },
    });
    expect(
      JSON.stringify(authAuditService.recordSafely.mock.calls),
    ).not.toContain(result.token);
  });

  it("authenticates a valid PAT and updates lastUsedAt", async () => {
    const repository = createRepositoryMock();
    const createState = installCreateMock(repository);
    const service = createService(repository);
    const created = await service.create({
      userId: USER_1_ID,
      name: "Rentify MCP",
      scopes: ["mcp:read"],
      expiresInDays: 30,
    });
    const [, publicId, secret] = created.token.split("_");

    repository.findByPublicId.mockResolvedValue(
      createTokenRecord({
        publicId,
        secretHash: createState.getLatestInput()?.secretHash as string,
      }),
    );

    const principal = await service.authenticateToken(
      `rpat_${publicId}_${secret}`,
    );

    expect(principal).toMatchObject({
      sub: USER_1_ID,
      authMethod: "pat",
      scopes: ["mcp:read"],
    });
    expect(repository.touchLastUsedAt).toHaveBeenCalledWith(PAT_RECORD_1_ID);
  });

  it("rejects PATs with invalid formats before repository lookup", async () => {
    const repository = createRepositoryMock();
    const service = createService(repository);

    await expect(
      service.authenticateToken("not-a-real-pat"),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repository.findByPublicId).not.toHaveBeenCalled();
    expect(repository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it("rejects unknown PAT public ids without updating lastUsedAt", async () => {
    const repository = createRepositoryMock();
    const service = createService(repository);

    repository.findByPublicId.mockResolvedValue(null);

    await expect(
      service.authenticateToken(
        "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it("rejects PATs when the secret does not match the stored hash", async () => {
    const repository = createRepositoryMock();
    const createState = installCreateMock(repository);
    const service = createService(repository);
    const created = await service.create({
      userId: USER_1_ID,
      name: "Rentify MCP",
      scopes: ["mcp:read"],
      expiresInDays: 30,
    });
    const [, publicId] = created.token.split("_");

    repository.findByPublicId.mockResolvedValue(
      createTokenRecord({
        publicId,
        secretHash: createState.getLatestInput()?.secretHash as string,
      }),
    );

    await expect(
      service.authenticateToken(
        `rpat_${publicId}_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it("rejects revoked PATs", async () => {
    const repository = createRepositoryMock();
    const createState = installCreateMock(repository);
    const service = createService(repository);
    const created = await service.create({
      userId: USER_1_ID,
      name: "Rentify MCP",
      scopes: ["mcp:read"],
      expiresInDays: 30,
    });
    const [, publicId] = created.token.split("_");

    repository.findByPublicId.mockResolvedValue(
      createTokenRecord({
        publicId,
        secretHash: createState.getLatestInput()?.secretHash as string,
        revokedAt: "2026-04-26T12:00:00.000Z",
      }),
    );

    await expect(
      service.authenticateToken(created.token),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it("rejects expired PATs", async () => {
    const repository = createRepositoryMock();
    const createState = installCreateMock(repository);
    const service = createService(repository);
    const created = await service.create({
      userId: USER_1_ID,
      name: "Rentify MCP",
      scopes: ["mcp:read"],
      expiresInDays: 30,
    });
    const [, publicId] = created.token.split("_");

    repository.findByPublicId.mockResolvedValue(
      createTokenRecord({
        publicId,
        secretHash: createState.getLatestInput()?.secretHash as string,
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );

    await expect(
      service.authenticateToken(created.token),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(repository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it.each(["locked", "suspended"] as const)(
    "rejects a valid PAT once its owner is %s",
    async (status) => {
      const repository = createRepositoryMock();
      const createState = installCreateMock(repository);
      const service = createService(repository);
      const created = await service.create({
        userId: USER_1_ID,
        name: "Rentify MCP",
        scopes: ["mcp:read"],
        expiresInDays: 30,
      });
      const [, publicId] = created.token.split("_");

      repository.findByPublicId.mockResolvedValue(
        createTokenRecord({
          publicId,
          secretHash: createState.getLatestInput()?.secretHash as string,
          user: {
            id: USER_1_ID,
            email: "user@example.com",
            role: "owner",
            status,
          },
        }),
      );

      await expect(
        service.authenticateToken(created.token),
      ).rejects.toMatchObject({
        status: 401,
        message: "Personal access token is no longer valid.",
      });
      expect(repository.touchLastUsedAt).not.toHaveBeenCalled();
    },
  );

  it("revokes tokens for the owning user", async () => {
    const repository = createRepositoryMock();
    const authAuditService = { recordSafely: jest.fn(async () => undefined) };
    const service = new PersonalAccessTokenService(
      repository as any,
      authAuditService as any,
      { personalAccessTokenSecret: "test-pat-secret" },
    );

    repository.findByIdForUser.mockResolvedValue(createTokenRecord());

    const result = await service.revoke({
      userId: USER_1_ID,
      tokenId: PAT_RECORD_1_ID,
      sessionId: "session-1",
    });

    expect(result).toEqual({
      revoked: true,
      tokenId: PAT_RECORD_1_ID,
    });
    expect(repository.revoke).toHaveBeenCalledWith(PAT_RECORD_1_ID);
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "pat.revoked",
      outcome: "success",
      userId: USER_1_ID,
      method: "pat",
      sessionId: "session-1",
      context: undefined,
      metadata: { tokenId: PAT_RECORD_1_ID },
    });
  });

  it("does not audit revoking a token that was already revoked", async () => {
    const repository = createRepositoryMock();
    const authAuditService = { recordSafely: jest.fn(async () => undefined) };
    const service = new PersonalAccessTokenService(
      repository as any,
      authAuditService as any,
      { personalAccessTokenSecret: "test-pat-secret" },
    );
    repository.findByIdForUser.mockResolvedValue(
      createTokenRecord({ revokedAt: "2026-04-26T12:00:00.000Z" }),
    );

    await service.revoke({ userId: USER_1_ID, tokenId: PAT_RECORD_1_ID });

    expect(repository.revoke).not.toHaveBeenCalled();
    expect(authAuditService.recordSafely).not.toHaveBeenCalled();
  });
});
