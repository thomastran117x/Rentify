import { CaptchaService } from "@/features/auth/captcha/captcha.service";

function createService(options?: {
  secretKey?: string;
  verificationUrl?: string;
  allowedHosts?: string[];
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  requestTimeoutMs?: number;
}) {
  return new CaptchaService({
    secretKey: options?.secretKey,
    verificationUrl: options?.verificationUrl,
    allowedHosts: options?.allowedHosts,
    maxRetries: options?.maxRetries,
    initialDelayMs: options?.initialDelayMs,
    maxDelayMs: options?.maxDelayMs,
    backoffMultiplier: options?.backoffMultiplier,
    requestTimeoutMs: options?.requestTimeoutMs,
  });
}

describe("CaptchaService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fails open when captcha is not configured", async () => {
    const service = createService({
      secretKey: "",
    });

    await expect(
      service.verify({
        token: "captcha-token",
      }),
    ).resolves.toEqual({
      success: true,
      failOpen: true,
      errors: ["turnstile-not-configured"],
    });
  });

  it("accepts the local development bypass token outside production", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const service = createService({
      secretKey: "test-secret",
    });

    await expect(
      service.verify({
        token: "local-dev-bypass",
      }),
    ).resolves.toEqual({
      success: true,
      failOpen: false,
      errors: [],
      action: "local-development-bypass",
      challengeTimestamp: undefined,
      hostname: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the captcha token is missing", async () => {
    const service = createService();

    await expect(
      service.verify({
        token: "   ",
      }),
    ).resolves.toEqual({
      success: false,
      failOpen: false,
      errors: ["missing-input-response"],
    });
  });

  it("submits captcha verification and returns turnstile metadata on success", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          "error-codes": [],
          hostname: "rent.example.com",
          action: "login",
          challenge_ts: "2026-04-19T12:00:00.000Z",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    const service = createService({
      secretKey: "test-secret",
      verificationUrl:
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      allowedHosts: ["challenges.cloudflare.com"],
    });

    const result = await service.verify({
      token: " captcha-token ",
      remoteIp: "127.0.0.1",
      idempotencyKey: "request-123",
    });

    expect(result).toEqual({
      success: true,
      failOpen: false,
      errors: [],
      hostname: "rent.example.com",
      action: "login",
      challengeTimestamp: "2026-04-19T12:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect((init?.body as URLSearchParams).toString()).toBe(
      "secret=test-secret&response=captcha-token&remoteip=127.0.0.1&idempotency_key=request-123",
    );
  });

  it("fails closed on non-transient turnstile HTTP errors", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const service = createService();

    await expect(
      service.verify({
        token: "captcha-token",
      }),
    ).resolves.toEqual({
      success: false,
      failOpen: false,
      errors: ["turnstile-http-400"],
    });
  });

  it("retries transient failures and succeeds when turnstile recovers", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("temporary error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            hostname: "rent.example.com",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
    jest.spyOn(Math, "random").mockReturnValue(0);
    const service = createService({
      maxRetries: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    await expect(
      service.verify({
        token: "captcha-token",
      }),
    ).resolves.toEqual({
      success: true,
      failOpen: false,
      errors: [],
      hostname: "rent.example.com",
      action: undefined,
      challengeTimestamp: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails open after exhausting transient retries", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed", {
        cause: {
          code: "ETIMEDOUT",
        },
      } as ErrorOptions),
    );
    jest.spyOn(Math, "random").mockReturnValue(0);
    const service = createService({
      maxRetries: 2,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });

    await expect(
      service.verify({
        token: "captcha-token",
      }),
    ).resolves.toEqual({
      success: true,
      failOpen: true,
      errors: ["ETIMEDOUT", "transient-failures:3"],
    });
  });
});
