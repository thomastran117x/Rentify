import { createHash } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import OAuthStateInvalidError from "@/errors/http/oauth-state-invalid.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { OAuthFlowService } from "@/features/auth/oauth/oauth-flow.service";
import {
  OAuthFlowStore,
  type OAuthFlowCache,
  type OAuthFlowRecord,
} from "@/features/auth/oauth/oauth-flow.store";

/** An in-memory stand-in for the two cache operations the store uses. */
function createCache() {
  const values = new Map<string, string>();

  return {
    values,
    setJson: jest.fn(async (key: string, value: unknown, _ttl?: number) => {
      values.set(key, JSON.stringify(value));
    }),
    getDeleteJson: jest.fn(async <T>(key: string): Promise<T | null> => {
      const value = values.get(key);
      values.delete(key);
      return value === undefined ? null : (JSON.parse(value) as T);
    }),
  };
}

function createService() {
  const cache = createCache();
  const store = new OAuthFlowStore(cache as OAuthFlowCache);
  return { cache, store, service: new OAuthFlowService(store) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

const ORIGINAL_SWITCH = process.env.OAUTH_CLIENT_ID_TOKEN_PROVIDERS;

afterEach(() => {
  if (ORIGINAL_SWITCH === undefined) {
    delete process.env.OAUTH_CLIENT_ID_TOKEN_PROVIDERS;
  } else {
    process.env.OAUTH_CLIENT_ID_TOKEN_PROVIDERS = ORIGINAL_SWITCH;
  }
});

describe("OAuthFlowStore", () => {
  it("keys a flow by the hash of its state, with a ten-minute expiry", async () => {
    const { cache, store } = createService();
    const record = { provider: "google" } as OAuthFlowRecord;

    await store.save("state-1", record);

    expect(cache.setJson).toHaveBeenCalledWith(
      `auth:oauth-flow:${sha256("state-1")}`,
      record,
      600,
    );
    expect([...cache.values.keys()].join()).not.toContain("state-1");
  });

  it("hands a flow out once", async () => {
    const { store } = createService();
    const record = { provider: "apple" } as OAuthFlowRecord;
    await store.save("state-2", record);

    await expect(store.consume("state-2")).resolves.toEqual(record);
    await expect(store.consume("state-2")).resolves.toBeNull();
  });

  it("does not look up an empty state", async () => {
    const { cache, store } = createService();

    await expect(store.consume("")).resolves.toBeNull();
    expect(cache.getDeleteJson).not.toHaveBeenCalled();
  });
});

describe("OAuthFlowService.start", () => {
  it("issues a Google code flow with a server-held PKCE verifier", async () => {
    const { cache, service } = createService();

    const result = await service.start({
      provider: "google",
      intent: "login",
      deviceId: "device-1",
    });

    expect(result).toEqual({
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tokenDelivery: "code",
      expiresInSeconds: 600,
    });
    expect(result.state).not.toBe(result.nonce);
    const stored = JSON.parse(
      cache.values.get(`auth:oauth-flow:${sha256(result.state)}`) ?? "null",
    ) as OAuthFlowRecord;
    expect(stored).toMatchObject({
      provider: "google",
      intent: "login",
      nonce: result.nonce,
      tokenDelivery: "code",
      deviceId: "device-1",
    });
    expect(stored.userId).toBeUndefined();
    expect(sha256(stored.codeVerifier ?? "")).toBe(result.codeChallenge);
  });

  it.each(["microsoft", "apple"] as const)(
    "issues %s as an ID-token flow without PKCE by default",
    async (provider) => {
      delete process.env.OAUTH_CLIENT_ID_TOKEN_PROVIDERS;
      const { service } = createService();

      const result = await service.start({
        provider,
        intent: "signup",
        deviceId: "device-1",
      });

      expect(result.tokenDelivery).toBe("id_token");
      expect(result).not.toHaveProperty("codeChallenge");
    },
  );

  it("moves Microsoft to the backend code exchange when the switch is off", async () => {
    process.env.OAUTH_CLIENT_ID_TOKEN_PROVIDERS = "none";
    const { service } = createService();

    const result = await service.start({
      provider: "microsoft",
      intent: "login",
      deviceId: "device-1",
    });

    expect(result.tokenDelivery).toBe("code");
    expect(result.codeChallenge).toEqual(expect.any(String));
  });

  it("gives an Apple code flow no PKCE challenge", async () => {
    process.env.OAUTH_CLIENT_ID_TOKEN_PROVIDERS = "microsoft";
    const { service } = createService();

    const result = await service.start({
      provider: "apple",
      intent: "login",
      deviceId: "device-1",
    });

    expect(result.tokenDelivery).toBe("code");
    expect(result).not.toHaveProperty("codeChallenge");
  });

  it("binds a link flow to the account that started it", async () => {
    const { cache, service } = createService();

    const result = await service.start({
      provider: "google",
      intent: "link",
      deviceId: "device-1",
      userId: "user-1",
    });

    expect(
      JSON.parse(
        cache.values.get(`auth:oauth-flow:${sha256(result.state)}`) ?? "null",
      ),
    ).toMatchObject({ intent: "link", userId: "user-1" });
  });

  it("does not keep a user on a sign-in flow", async () => {
    const { cache, service } = createService();

    const result = await service.start({
      provider: "google",
      intent: "login",
      deviceId: "device-1",
      userId: "user-1",
    });

    expect(
      JSON.parse(
        cache.values.get(`auth:oauth-flow:${sha256(result.state)}`) ?? "null",
      ).userId,
    ).toBeUndefined();
  });

  it("requires a device id", async () => {
    const { cache, service } = createService();

    await expect(
      service.start({ provider: "google", intent: "login" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it("requires an account for a link flow", async () => {
    const { service } = createService();

    await expect(
      service.start({ provider: "google", intent: "link", deviceId: "d" }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("issues independent flows for concurrent tabs", async () => {
    const { service } = createService();
    const input = {
      provider: "google" as const,
      intent: "login" as const,
      deviceId: "device-1",
    };

    const [first, second] = await Promise.all([
      service.start(input),
      service.start(input),
    ]);

    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login"],
        state: second.state,
        deviceId: "device-1",
        code: "code-2",
      }),
    ).resolves.toMatchObject({ nonce: second.nonce });
    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login"],
        state: first.state,
        deviceId: "device-1",
        code: "code-1",
      }),
    ).resolves.toMatchObject({ nonce: first.nonce });
  });
});

describe("OAuthFlowService.redeem", () => {
  async function startFlow(
    service: OAuthFlowService,
    overrides: Partial<Parameters<OAuthFlowService["start"]>[0]> = {},
  ) {
    return service.start({
      provider: "google",
      intent: "login",
      deviceId: "device-1",
      ...overrides,
    });
  }

  it("returns the server's nonce and verifier for the code", async () => {
    const { store, service } = createService();
    const consume = jest.spyOn(store, "consume");
    const started = await startFlow(service);

    const redeemed = await service.redeem({
      provider: "google",
      allowedIntents: ["login", "signup"],
      state: started.state,
      deviceId: "device-1",
      code: "auth-code",
    });

    expect(redeemed).toEqual({
      nonce: started.nonce,
      code: "auth-code",
      codeVerifier: expect.any(String),
    });
    expect(
      createHash("sha256")
        .update(redeemed.codeVerifier ?? "")
        .digest("base64url"),
    ).toBe(started.codeChallenge);
    expect(consume).toHaveBeenCalledWith(started.state);
  });

  it("returns the server's nonce for an ID-token flow", async () => {
    const { service } = createService();
    const started = await startFlow(service, { provider: "apple" });

    await expect(
      service.redeem({
        provider: "apple",
        allowedIntents: ["login"],
        state: started.state,
        deviceId: "device-1",
        idToken: "apple-id-token",
      }),
    ).resolves.toEqual({ nonce: started.nonce, idToken: "apple-id-token" });
  });

  it("rejects a state it never issued", async () => {
    const { service } = createService();

    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login"],
        state: "made-up-state",
        deviceId: "device-1",
        code: "auth-code",
      }),
    ).rejects.toBeInstanceOf(OAuthStateInvalidError);
  });

  it("rejects a state that was already used", async () => {
    const { service } = createService();
    const started = await startFlow(service);
    const input = {
      provider: "google" as const,
      allowedIntents: ["login"] as const,
      state: started.state,
      deviceId: "device-1",
      code: "auth-code",
    };

    await service.redeem(input);

    await expect(service.redeem(input)).rejects.toBeInstanceOf(
      OAuthStateInvalidError,
    );
  });

  it.each([
    ["another provider", { provider: "microsoft" as const }],
    ["another device", { deviceId: "device-2" }],
    ["no device", { deviceId: undefined }],
    ["an intent this endpoint does not finish", { allowedIntents: ["link"] }],
  ])("rejects a state presented for %s", async (_label, overrides) => {
    const { service } = createService();
    const started = await startFlow(service);

    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login", "signup"],
        state: started.state,
        deviceId: "device-1",
        code: "auth-code",
        ...(overrides as object),
      }),
    ).rejects.toBeInstanceOf(OAuthStateInvalidError);
  });

  it("spends a state even when a check fails", async () => {
    const { service } = createService();
    const started = await startFlow(service);

    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login"],
        state: started.state,
        deviceId: "device-2",
        code: "auth-code",
      }),
    ).rejects.toBeInstanceOf(OAuthStateInvalidError);
    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login"],
        state: started.state,
        deviceId: "device-1",
        code: "auth-code",
      }),
    ).rejects.toBeInstanceOf(OAuthStateInvalidError);
  });

  it("rejects a link state presented by another account", async () => {
    const { service } = createService();
    const started = await startFlow(service, {
      intent: "link",
      userId: "user-1",
    });

    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["link"],
        state: started.state,
        deviceId: "device-1",
        userId: "user-2",
        code: "auth-code",
      }),
    ).rejects.toBeInstanceOf(OAuthStateInvalidError);
  });

  it("accepts a link state from the account that started it", async () => {
    const { service } = createService();
    const started = await startFlow(service, {
      intent: "link",
      userId: "user-1",
    });

    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["link"],
        state: started.state,
        deviceId: "device-1",
        userId: "user-1",
        code: "auth-code",
      }),
    ).resolves.toMatchObject({ nonce: started.nonce });
  });

  it.each([
    ["an ID token", { idToken: "raw-id-token", code: undefined }],
    ["an ID token alongside the code", { idToken: "raw-id-token" }],
    ["neither", { code: undefined }],
  ])("refuses %s on a code flow", async (_label, overrides) => {
    const { service } = createService();
    const started = await startFlow(service);

    await expect(
      service.redeem({
        provider: "google",
        allowedIntents: ["login"],
        state: started.state,
        deviceId: "device-1",
        code: "auth-code",
        ...overrides,
      }),
    ).rejects.toMatchObject({
      message: "This sign-in must finish with an authorization code.",
    });
  });

  it.each([
    ["a code", { code: "auth-code", idToken: undefined }],
    ["neither", { idToken: undefined }],
  ])("refuses %s on an ID-token flow", async (_label, overrides) => {
    const { service } = createService();
    const started = await startFlow(service, { provider: "microsoft" });

    await expect(
      service.redeem({
        provider: "microsoft",
        allowedIntents: ["login"],
        state: started.state,
        deviceId: "device-1",
        idToken: "id-token",
        ...(overrides as object),
      }),
    ).rejects.toMatchObject({
      message: "This sign-in must finish with an ID token.",
    });
  });
});
