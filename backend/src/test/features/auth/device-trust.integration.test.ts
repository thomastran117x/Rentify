import { buildApiPath } from "@/configuration/http/api-path";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import { DEVICE_BINDING_COOKIE_NAME } from "@/features/auth/device/device-binding";
import { completeEmailStepUp } from "../../support/mfa-step-up";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { generateTotpCode } from "../../support/totp-client";

// Off the harness's MFA bypass list, so every step here is the real one.
const ACCOUNT = {
  email: "owner1@rentify.local",
  username: "owner-one",
  password: "Rentify123!",
};
const ORIGIN = "http://localhost:3040";
const DEVICE_HINT = "trust-test-laptop";

interface Envelope<T> {
  data: T;
  error: { code?: string; details?: Record<string, unknown> } | null;
}

interface SessionBody {
  accessToken: string;
  device: { known: boolean; trustedUntil?: string };
}

interface BrowserSession {
  accessToken: string;
  refreshToken: string | null;
  csrfToken: string | null;
  device: SessionBody["device"];
}

function readCookie(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const separator = pair!.indexOf("=");

    if (pair!.slice(0, separator) === name) {
      return decodeURIComponent(pair!.slice(separator + 1)) || null;
    }
  }

  return null;
}

// Each scenario signs in several times, and every sign-in checks a bcrypt hash.
jest.setTimeout(90_000);

/**
 * "Remember this device": a bound device that finished login MFA with the box
 * ticked skips the code at later sign-ins, until the trust lapses or a
 * security change ends it. Step-up is never skipped.
 */
describe("Trusted device integration", () => {
  let persistenceApp: PersistenceTestApp;
  let secret: string;
  // Each authenticator code is good once, so every use takes the next step.
  let totpStep = 0;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function bodyOf<T>(response: Response) {
    return (await response.json()) as Envelope<T>;
  }

  /** Runs `run` with the clock moved to the next unused TOTP step. */
  async function withFreshCode<T>(run: (code: string) => Promise<T>) {
    totpStep += 1;
    const realNow = Date.now.bind(Date);
    const offset = totpStep * 30_000;
    const spy = jest
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() + offset);

    try {
      return await run(generateTotpCode(secret, { timestampMs: Date.now() }));
    } finally {
      spy.mockRestore();
    }
  }

  function browserHeaders(deviceCookie?: string | null) {
    return {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "x-device-id": DEVICE_HINT,
      ...(deviceCookie
        ? { cookie: `${DEVICE_BINDING_COOKIE_NAME}=${deviceCookie}` }
        : {}),
    };
  }

  function sessionHeaders(
    session: BrowserSession,
    deviceCookie?: string | null,
  ): Record<string, string> {
    return {
      ...browserHeaders(),
      authorization: `Bearer ${session.accessToken}`,
      cookie: [
        `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}`,
        `${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
        ...(deviceCookie
          ? [`${DEVICE_BINDING_COOKIE_NAME}=${deviceCookie}`]
          : []),
      ].join("; "),
      [CSRF_TOKEN_HEADER_NAME]: session.csrfToken ?? "",
    };
  }

  async function enroll() {
    const session = await createAuthenticatedRequestContext({
      email: ACCOUNT.email,
    });
    await completeEmailStepUp(persistenceApp.app, session.headers());
    const begin = await request("/auth/mfa/totp/begin", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ accountName: session.email }),
    });
    secret = (await bodyOf<{ secret: string }>(begin)).data.secret;
    totpStep = 0;
    const confirm = await request("/auth/mfa/totp/confirm", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    expect(confirm.status).toBe(200);
  }

  function signIn(deviceCookie?: string | null) {
    return request("/auth/local/login", {
      method: "POST",
      headers: browserHeaders(deviceCookie),
      body: JSON.stringify({
        username: ACCOUNT.username,
        password: ACCOUNT.password,
        captchaToken: "captcha-ok-login",
        deviceId: DEVICE_HINT,
      }),
    });
  }

  function toSession(response: Response, body: SessionBody): BrowserSession {
    return {
      accessToken: body.accessToken,
      refreshToken: readCookie(response, REFRESH_TOKEN_COOKIE_NAME),
      csrfToken: readCookie(response, CSRF_TOKEN_COOKIE_NAME),
      device: body.device,
    };
  }

  /**
   * A first sign-in from a new browser, finished with a code and "Remember
   * this device". Returns the device cookie and the session.
   */
  async function rememberDevice(): Promise<{
    deviceCookie: string;
    session: BrowserSession;
  }> {
    const first = await signIn();
    expect(first.status).toBe(401);
    const deviceCookie = readCookie(first, DEVICE_BINDING_COOKIE_NAME)!;
    const { error } = await bodyOf(first);
    expect(error?.details).toMatchObject({
      mfaRequired: true,
      rememberDeviceDays: 30,
    });

    const finished = await withFreshCode((code) =>
      request("/auth/login/mfa", {
        method: "POST",
        headers: browserHeaders(deviceCookie),
        body: JSON.stringify({
          mfaChallengeToken: (error?.details as { mfaChallengeToken: string })
            .mfaChallengeToken,
          factor: "totp",
          code,
          deviceId: DEVICE_HINT,
          rememberDevice: true,
        }),
      }),
    );
    expect(finished.status).toBe(200);
    const body = (await bodyOf<SessionBody>(finished)).data;
    expect(body.device).toMatchObject({
      known: true,
      trustedUntil: expect.any(String),
    });

    return { deviceCookie, session: toSession(finished, body) };
  }

  async function expectSignInSkipsCode(deviceCookie: string) {
    const response = await signIn(deviceCookie);
    expect(response.status).toBe(200);
    const body = (await bodyOf<SessionBody>(response)).data;
    expect(body.device).toMatchObject({
      known: true,
      trustedUntil: expect.any(String),
    });
    return toSession(response, body);
  }

  async function expectSignInAsksForCode(deviceCookie?: string | null) {
    const response = await signIn(deviceCookie);
    expect(response.status).toBe(401);
    await expect(bodyOf(response)).resolves.toMatchObject({
      error: { details: { mfaRequired: true } },
    });
  }

  /** A TOTP step-up for the mfa-management scope on this session. */
  async function stepUp(session: BrowserSession) {
    const response = await withFreshCode((code) =>
      request("/auth/mfa/verify/confirm", {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ scope: "mfa-management", factor: "totp", code }),
      }),
    );
    expect(response.status).toBe(200);
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await enroll();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("skips login MFA on the remembered device, and only there", async () => {
    const { deviceCookie } = await rememberDevice();
    const device = await persistenceApp.prisma.device.findFirstOrThrow({
      where: { deviceId: DEVICE_HINT },
    });
    expect(device.trustedUntil).not.toBeNull();

    const trusted = await expectSignInSkipsCode(deviceCookie);
    const skipped = await persistenceApp.prisma.authAuditEvent.findFirst({
      where: { eventType: "login.mfa_skipped_trusted_device" },
    });
    expect(skipped).not.toBeNull();

    // The same device id without its cookie is not the remembered device.
    await expectSignInAsksForCode();

    // Step-up is never skipped, even on the remembered device.
    const devices = await request("/auth/devices", {
      headers: sessionHeaders(trusted, deviceCookie),
    });
    expect(devices.status).toBe(401);
    await expect(bodyOf(devices)).resolves.toMatchObject({
      error: { code: "MFA_VERIFICATION_REQUIRED" },
    });
  });

  it("lists the device as trusted and stops trusting it on request", async () => {
    const { deviceCookie, session } = await rememberDevice();
    await stepUp(session);

    const listed = await request("/auth/devices", {
      headers: sessionHeaders(session, deviceCookie),
    });
    expect(listed.status).toBe(200);
    const { devices } = (
      await bodyOf<{
        devices: Array<{ deviceId: string; bound: boolean; trusted: boolean }>;
      }>(listed)
    ).data;
    // Beside the seeded devices, which registered before binding.
    expect(devices).toContainEqual(
      expect.objectContaining({
        deviceId: DEVICE_HINT,
        bound: true,
        trusted: true,
        trustedUntil: expect.any(String),
      }),
    );

    const revoked = await request("/auth/devices/trust", {
      method: "DELETE",
      headers: sessionHeaders(session, deviceCookie),
      body: JSON.stringify({ deviceId: DEVICE_HINT }),
    });
    expect(revoked.status).toBe(200);
    await expect(bodyOf(revoked)).resolves.toMatchObject({
      data: { revoked: true, deviceId: DEVICE_HINT },
    });

    await expectSignInAsksForCode(deviceCookie);
  });

  it("ends trust when the account signs out everywhere", async () => {
    const { deviceCookie, session } = await rememberDevice();
    await stepUp(session);

    const signedOut = await request("/auth/sessions/revoke-others", {
      method: "POST",
      headers: sessionHeaders(session, deviceCookie),
      body: JSON.stringify({ scope: "all" }),
    });
    expect(signedOut.status).toBe(200);

    await expectSignInAsksForCode(deviceCookie);
  });

  it("ends trust when the authenticator is turned off and on again", async () => {
    const { deviceCookie, session } = await rememberDevice();
    await stepUp(session);

    const disabled = await request("/auth/mfa/totp/disable", {
      method: "POST",
      headers: sessionHeaders(session, deviceCookie),
      body: JSON.stringify({}),
    });
    expect(disabled.status).toBe(200);
    const device = await persistenceApp.prisma.device.findFirstOrThrow({
      where: { deviceId: DEVICE_HINT },
    });
    expect(device.trustedUntil).toBeNull();
    await expect(
      persistenceApp.prisma.authAuditEvent.findFirst({
        where: { eventType: "device.trust_revoked" },
      }),
    ).resolves.toMatchObject({
      metadata: { reason: "mfa_disabled", scope: "all", count: 1 },
    });

    await enroll();
    await expectSignInAsksForCode(deviceCookie);
  });

  it("ends trust when the device is removed", async () => {
    const { deviceCookie, session } = await rememberDevice();
    await stepUp(session);

    const removed = await request("/auth/devices/remove", {
      method: "DELETE",
      headers: sessionHeaders(session, deviceCookie),
      body: JSON.stringify({ deviceId: DEVICE_HINT }),
    });
    expect(removed.status).toBe(200);

    await expectSignInAsksForCode(deviceCookie);
  });

  it("does not hand a remembered device's trust to a new cookie", async () => {
    const { deviceCookie: rememberedCookie } = await rememberDevice();

    // The device cookie alone is deleted; the hint survives. The new cookie
    // finishes MFA without "Remember this device" and registers the device.
    const first = await signIn();
    const newCookie = readCookie(first, DEVICE_BINDING_COOKIE_NAME)!;
    const { error } = await bodyOf(first);
    const finished = await withFreshCode((code) =>
      request("/auth/login/mfa", {
        method: "POST",
        headers: browserHeaders(newCookie),
        body: JSON.stringify({
          mfaChallengeToken: (error?.details as { mfaChallengeToken: string })
            .mfaChallengeToken,
          factor: "totp",
          code,
          deviceId: DEVICE_HINT,
        }),
      }),
    );
    expect(finished.status).toBe(200);
    const session = toSession(
      finished,
      (await bodyOf<SessionBody>(finished)).data,
    );
    const verified = await request("/auth/device/verify", {
      method: "POST",
      headers: sessionHeaders(session, newCookie),
    });
    expect(verified.status).toBe(200);

    // Neither the new cookie nor the old one skips the code now.
    await expectSignInAsksForCode(newCookie);
    await expectSignInAsksForCode(rememberedCookie);
  });

  it("remembers nothing for a client that keeps no cookies", async () => {
    const first = await signIn();
    const { error } = await bodyOf(first);

    const finished = await withFreshCode((code) =>
      request("/auth/login/mfa", {
        method: "POST",
        headers: browserHeaders(),
        body: JSON.stringify({
          mfaChallengeToken: (error?.details as { mfaChallengeToken: string })
            .mfaChallengeToken,
          factor: "totp",
          code,
          deviceId: DEVICE_HINT,
          rememberDevice: true,
        }),
      }),
    );

    expect(finished.status).toBe(200);
    const body = (await bodyOf<SessionBody>(finished)).data;
    expect(body.device.trustedUntil).toBeUndefined();
    await expect(
      persistenceApp.prisma.device.count({
        where: { trustedUntil: { not: null } },
      }),
    ).resolves.toBe(0);
  });
});
