import { buildApiPath } from "@/configuration/http/api-path";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import {
  DEVICE_BINDING_COOKIE_NAME,
  verifyDeviceBindingCookieValue,
} from "@/features/auth/device/device-binding";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const RENTER_ONE = { username: "renter-one", password: "Rentify123!" };
const DEVICE_HINT = "binding-test-laptop";

interface Session {
  accessToken: string;
  refreshToken: string | null;
  csrfToken: string | null;
  deviceCookie: string | null;
  device: { deviceId?: string; known: boolean; knownByIp: boolean };
}

function readCookie(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const separator = pair!.indexOf("=");

    if (pair!.slice(0, separator) === name) {
      return pair!.slice(separator + 1) || null;
    }
  }

  return null;
}

// Every scenario signs in several times, and every sign-in checks a bcrypt hash.
jest.setTimeout(60_000);

describe("Device binding integration", () => {
  let persistenceApp: PersistenceTestApp;
  const originalTrustedProxyHops = process.env.TRUSTED_PROXY_HOPS;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function login(input: {
    ip: string;
    deviceCookie?: string | null;
    deviceId?: string;
  }): Promise<Session> {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-device-id": input.deviceId ?? DEVICE_HINT,
        "x-forwarded-for": input.ip,
        ...(input.deviceCookie
          ? { cookie: `${DEVICE_BINDING_COOKIE_NAME}=${input.deviceCookie}` }
          : {}),
      },
      body: JSON.stringify({ ...RENTER_ONE, captchaToken: "captcha-ok-login" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { accessToken: string; device: Session["device"] };
    };

    return {
      accessToken: body.data.accessToken,
      refreshToken: readCookie(response, REFRESH_TOKEN_COOKIE_NAME),
      csrfToken: readCookie(response, CSRF_TOKEN_COOKIE_NAME),
      deviceCookie: readCookie(response, DEVICE_BINDING_COOKIE_NAME),
      device: body.data.device,
    };
  }

  function sessionHeaders(
    session: Session,
    input: { ip: string; deviceCookie?: string | null },
  ): Record<string, string> {
    return {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      origin: ORIGIN,
      "x-device-id": DEVICE_HINT,
      "x-forwarded-for": input.ip,
      cookie: [
        `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}`,
        `${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
        ...(input.deviceCookie
          ? [`${DEVICE_BINDING_COOKIE_NAME}=${input.deviceCookie}`]
          : []),
      ].join("; "),
      [CSRF_TOKEN_HEADER_NAME]: session.csrfToken ?? "",
    };
  }

  /** A first sign-in, then the device check that registers the browser. */
  async function registerBoundDevice(ip: string): Promise<string> {
    const first = await login({ ip });
    const deviceCookie = decodeURIComponent(first.deviceCookie!);
    const verify = await request("/auth/device/verify", {
      method: "POST",
      headers: sessionHeaders(first, { ip, deviceCookie }),
    });
    expect(verify.status).toBe(200);
    await expect(verify.json()).resolves.toMatchObject({
      data: { device: { known: true } },
    });

    return deviceCookie;
  }

  function newDeviceEvents() {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "device.new_detected" },
    });
  }

  beforeAll(async () => {
    // Each scenario signs in from its own address.
    process.env.TRUSTED_PROXY_HOPS = "1";
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
    if (originalTrustedProxyHops === undefined) {
      delete process.env.TRUSTED_PROXY_HOPS;
    } else {
      process.env.TRUSTED_PROXY_HOPS = originalTrustedProxyHops;
    }
  }, 180_000);

  it("hands a browser a signed device cookie at its first sign-in", async () => {
    const session = await login({ ip: "198.51.100.10" });

    expect(session.device.known).toBe(false);
    expect(
      verifyDeviceBindingCookieValue(decodeURIComponent(session.deviceCookie!)),
    ).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("knows a registered browser by its cookie on any network", async () => {
    const deviceCookie = await registerBoundDevice("198.51.100.20");
    const device = await persistenceApp.prisma.device.findFirstOrThrow({
      where: { deviceId: DEVICE_HINT },
    });
    expect(device.bindingId).toBe(verifyDeviceBindingCookieValue(deviceCookie));
    await persistenceApp.prisma.authAuditEvent.deleteMany({});

    const again = await login({ ip: "203.0.113.20", deviceCookie });

    expect(again.device).toMatchObject({
      deviceId: DEVICE_HINT,
      known: true,
      knownByIp: false,
    });
    await expect(newDeviceEvents()).resolves.toHaveLength(0);
  });

  it("does not let a forged x-device-id make a sign-in look known", async () => {
    await registerBoundDevice("198.51.100.30");
    await persistenceApp.prisma.authAuditEvent.deleteMany({});

    // The registered device's id, sent from somewhere new without its cookie.
    const forged = await login({ ip: "203.0.113.30" });

    expect(forged.device).toMatchObject({
      deviceId: DEVICE_HINT,
      known: false,
      knownByIp: false,
    });
    // Recorded whether or not the email's cooldown, started by the first
    // sign-in with this hint, lets it send; detection rule (c) reads the event.
    const [event] = await newDeviceEvents();
    expect(event).toMatchObject({ deviceId: DEVICE_HINT });
    expect(event?.metadata).toMatchObject({ deviceBinding: "unverified" });
  });

  it("refuses a device cookie with a forged signature", async () => {
    const deviceCookie = await registerBoundDevice("198.51.100.40");
    const [id] = deviceCookie.split(".");

    const forged = await login({
      ip: "203.0.113.40",
      deviceCookie: `${id}.${"A".repeat(43)}`,
    });

    expect(forged.device.known).toBe(false);
    // The forged cookie is replaced with a fresh binding.
    expect(
      verifyDeviceBindingCookieValue(decodeURIComponent(forged.deviceCookie!)),
    ).not.toBe(id);
  });

  it("keeps a bound session's device known across a refresh", async () => {
    const deviceCookie = await registerBoundDevice("198.51.100.50");
    const session = await login({ ip: "198.51.100.50", deviceCookie });

    const refreshed = await request("/auth/refresh", {
      method: "POST",
      headers: sessionHeaders(session, { ip: "203.0.113.50", deviceCookie }),
      body: JSON.stringify({}),
    });

    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      data: { device: { known: true } },
    });
    // Renewed with the same binding.
    expect(
      decodeURIComponent(readCookie(refreshed, DEVICE_BINDING_COOKIE_NAME)!),
    ).toBe(deviceCookie);
  });

  it("keeps a client without cookies working, never known by device", async () => {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "cli-client",
        "x-forwarded-for": "198.51.100.60",
      },
      body: JSON.stringify({ ...RENTER_ONE, captchaToken: "captcha-ok-login" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        refreshToken: expect.any(String),
        device: { deviceId: "cli-client", known: false },
      },
    });
  });
});
