import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import type { PersonalAccessTokenService } from "@/features/auth/personal-access-token/personal-access-token.service";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import {
  createClaims,
  createContext,
  invoke,
} from "../../support/auth-controller-harness";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 410101);
const TOKEN_ID = testUuid(9000, 410102);

const mockRequireSessionAuth = jest.fn();
const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

const createBody = {
  name: "Rentify MCP",
  scopes: ["mcp:read"],
  expiresInDays: 30,
};

function createController() {
  const personalAccessTokenService = {
    listForUser: jest.fn(async () => ({ tokens: [] })),
    create: jest.fn(async () => ({ id: TOKEN_ID, token: "rpat_secret" })),
    revoke: jest.fn(async () => ({ revoked: true, tokenId: TOKEN_ID })),
  };

  return {
    personalAccessTokenService,
    controller: new PersonalAccessTokenController(
      personalAccessTokenService as unknown as PersonalAccessTokenService,
      {} as MfaVerificationService,
    ),
  };
}

const auth = createClaims({ sub: USER_ID, sessionId: "session-1" });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireSessionAuth.mockResolvedValue(auth);
  mockRequireRecentMfaVerification.mockResolvedValue(auth);
});

describe("PersonalAccessTokenController", () => {
  it("lists tokens without a step-up", async () => {
    const { controller, personalAccessTokenService } = createController();

    await invoke(controller.list, createContext({ auth }));

    expect(personalAccessTokenService.listForUser).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
  });

  it("creates a token once the session has a recent proof", async () => {
    const { controller, personalAccessTokenService } = createController();

    const response = await invoke(
      controller.create,
      createContext({ auth, body: createBody }),
    );

    expect(response.status).toBe(201);
    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
    expect(personalAccessTokenService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, name: "Rentify MCP" }),
    );
  });

  it("revokes a token once the session has a recent proof", async () => {
    const { controller, personalAccessTokenService } = createController();

    await invoke(
      controller.revoke,
      createContext({ auth, params: { id: TOKEN_ID } }),
    );

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
    expect(personalAccessTokenService.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, tokenId: TOKEN_ID }),
    );
  });

  it("changes nothing without a recent proof", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new MfaVerificationRequiredError(),
    );
    const { controller, personalAccessTokenService } = createController();

    await expect(
      invoke(controller.create, createContext({ auth, body: createBody })),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
    await expect(
      invoke(
        controller.revoke,
        createContext({ auth, params: { id: TOKEN_ID } }),
      ),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);

    expect(personalAccessTokenService.create).not.toHaveBeenCalled();
    expect(personalAccessTokenService.revoke).not.toHaveBeenCalled();
  });
});
