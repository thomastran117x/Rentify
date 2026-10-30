import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Runs the real CaptchaService against a stubbed Turnstile siteverify, so the
 * hostname and action checks are exercised through a protected endpoint
 * rather than the suite-wide captcha stub.
 */
describe("Captcha verification persistence integration", () => {
  let persistenceApp: PersistenceTestApp;
  let siteverifyBody: Record<string, unknown>;
  const originalFetch = globalThis.fetch;

  async function signIn(): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: "renter-one",
          password: "Rentify123!",
          captchaToken: "turnstile-token",
        }),
      },
    );
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp({
      registerOverrides: (container) => {
        container.register({
          token: containerTokens.captchaService,
          lifetime: "singleton",
          dependencies: [],
          resolve: () =>
            new CaptchaService({ secretKey: "test-secret", maxRetries: 0 }),
        });
      },
    });
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input) === SITEVERIFY_URL
        ? new Response(JSON.stringify(siteverifyBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : originalFetch(input, init),
    );
  }, 180_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("accepts a token solved on the frontend's host for the login action", async () => {
    siteverifyBody = { success: true, hostname: "localhost", action: "login" };

    const response = await signIn();

    expect(response.status).toBe(200);
  });

  it("rejects a token solved for another flow's action", async () => {
    siteverifyBody = { success: true, hostname: "localhost", action: "signup" };

    const response = await signIn();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      message: "Captcha verification failed.",
      error: {
        code: "BAD_REQUEST",
        details: { errors: ["action-mismatch"], failOpen: false },
      },
    });
  });

  it("rejects a token solved on another site", async () => {
    siteverifyBody = {
      success: true,
      hostname: "evil.example",
      action: "login",
    };

    const response = await signIn();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "BAD_REQUEST",
        details: { errors: ["hostname-mismatch"] },
      },
    });
  });
});
