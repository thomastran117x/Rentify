import { environment } from "@/configuration/environment";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import {
  createDeviceBindingId,
  DEVICE_BINDING_COOKIE_NAME,
  getDeviceBindingCookieName,
  readDeviceBinding,
  SECURE_DEVICE_BINDING_COOKIE_NAME,
  signDeviceBindingId,
  toPublicClientContext,
  verifyDeviceBindingCookieValue,
  writeDeviceBindingCookie,
} from "@/features/auth/device/device-binding";
import { createMockRequest, createMockResponse } from "../../support/mock-http";

const SECRET = "device-binding-test-secret-of-32-chars";
const OTHER_SECRET = "another-device-binding-secret-32-chars";

const DEFAULT_ONLY = [
  { kid: "default", status: "current" as const, secret: SECRET },
];
const OTHER_ONLY = [
  { kid: "default", status: "current" as const, secret: OTHER_SECRET },
];
/** Mid-rotation: a new current key, the old one kept to verify. */
const ROTATED = [
  { kid: "2026-11", status: "current" as const, secret: OTHER_SECRET },
  { kid: "default", status: "previous" as const, secret: SECRET },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("device binding cookie values", () => {
  it("mints random 16-byte base64url ids", () => {
    const first = createDeviceBindingId();
    const second = createDeviceBindingId();

    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second).not.toBe(first);
  });

  it("verifies a value it signed and returns the id", () => {
    const id = createDeviceBindingId();

    expect(
      verifyDeviceBindingCookieValue(
        signDeviceBindingId(id, DEFAULT_ONLY),
        DEFAULT_ONLY,
      ),
    ).toEqual({ id, stale: false });
  });

  it("leaves the default kid out, so cookies keep their pre-keyset form", () => {
    const id = createDeviceBindingId();

    expect(signDeviceBindingId(id, DEFAULT_ONLY).split(".")).toHaveLength(2);
    expect(signDeviceBindingId(id, ROTATED).split(".")).toEqual([
      id,
      "2026-11",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    ]);
  });

  it("verifies a cookie from before a rotation, and flags it for re-issue", () => {
    const id = createDeviceBindingId();
    const beforeRotation = signDeviceBindingId(id, DEFAULT_ONLY);

    expect(verifyDeviceBindingCookieValue(beforeRotation, ROTATED)).toEqual({
      id,
      stale: true,
    });
    expect(
      verifyDeviceBindingCookieValue(signDeviceBindingId(id, ROTATED), ROTATED),
    ).toEqual({ id, stale: false });
  });

  it("refuses a cookie once its key is removed from the set", () => {
    const id = createDeviceBindingId();

    expect(
      verifyDeviceBindingCookieValue(signDeviceBindingId(id, DEFAULT_ONLY), [
        ROTATED[0]!,
      ]),
    ).toBeUndefined();
  });

  it("refuses a value signed with another secret, or under another kid", () => {
    const id = createDeviceBindingId();

    expect(
      verifyDeviceBindingCookieValue(
        signDeviceBindingId(id, OTHER_ONLY),
        DEFAULT_ONLY,
      ),
    ).toBeUndefined();
    const [, , signature] = signDeviceBindingId(id, ROTATED).split(".");
    expect(
      verifyDeviceBindingCookieValue(`${id}.default.${signature}`, ROTATED),
    ).toBeUndefined();
  });

  it("refuses an id swapped under another id's signature", () => {
    const [, signature] = signDeviceBindingId(
      createDeviceBindingId(),
      DEFAULT_ONLY,
    ).split(".");

    expect(
      verifyDeviceBindingCookieValue(
        `${createDeviceBindingId()}.${signature}`,
        DEFAULT_ONLY,
      ),
    ).toBeUndefined();
  });

  it.each([
    ["nothing", undefined],
    ["an empty value", ""],
    ["a bare id, as a client-chosen device id would be", "device-1"],
    ["a malformed id", "not-an-id.signature"],
    ["a truncated signature", `${"A".repeat(22)}.${"A".repeat(42)}`],
    ["an unknown kid", `${"A".repeat(22)}.unknown.${"A".repeat(43)}`],
    ["a malformed kid", `${"A".repeat(22)}.bad kid.${"A".repeat(43)}`],
    ["extra segments", `${"A".repeat(22)}.a.${"A".repeat(43)}.extra`],
  ])("refuses %s", (_label, value) => {
    expect(verifyDeviceBindingCookieValue(value, DEFAULT_ONLY)).toBeUndefined();
  });

  it("signs and verifies with the configured keyset by default", () => {
    const id = createDeviceBindingId();

    expect(verifyDeviceBindingCookieValue(signDeviceBindingId(id))).toEqual({
      id,
      stale: false,
    });
    expect(
      verifyDeviceBindingCookieValue(signDeviceBindingId(id), OTHER_ONLY),
    ).toBeUndefined();
  });

  it("refuses to sign without a current key", () => {
    expect(() =>
      signDeviceBindingId(createDeviceBindingId(), [
        { kid: "old", status: "previous", secret: SECRET },
      ]),
    ).toThrow("The device binding keyset needs a current key.");
  });
});

describe("device binding cookie names", () => {
  it("uses the __Host- name only with secure cookies", () => {
    expect(getDeviceBindingCookieName(true)).toBe(
      SECURE_DEVICE_BINDING_COOKIE_NAME,
    );
    expect(getDeviceBindingCookieName(false)).toBe(DEVICE_BINDING_COOKIE_NAME);
  });
});

describe("readDeviceBinding", () => {
  it("reads a verified cookie", () => {
    const id = createDeviceBindingId();
    const request = createMockRequest({
      headers: {
        cookie: `${DEVICE_BINDING_COOKIE_NAME}=${signDeviceBindingId(id)}`,
      },
    });

    expect(readDeviceBinding(request)).toEqual({ id });
  });

  it("flags a cookie signed with a key being rotated out", () => {
    const id = createDeviceBindingId();
    const oldCookie = signDeviceBindingId(id);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      deviceBindingKeys: [
        { kid: "2026-11", status: "current", secret: OTHER_SECRET },
        {
          ...environment.getTokenConfig().deviceBindingKeys[0]!,
          status: "previous",
        },
      ],
    });
    const request = createMockRequest({
      headers: { cookie: `${DEVICE_BINDING_COOKIE_NAME}=${oldCookie}` },
    });

    expect(readDeviceBinding(request)).toEqual({ id, stale: true });
  });

  it("ignores a forged cookie", () => {
    const request = createMockRequest({
      headers: {
        cookie: `${DEVICE_BINDING_COOKIE_NAME}=${"A".repeat(22)}.${"A".repeat(43)}`,
      },
    });

    expect(readDeviceBinding(request)).toBeUndefined();
  });

  it("reads only the __Host- name when cookies are secure", () => {
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      secureCookies: true,
    });
    const id = createDeviceBindingId();
    const value = signDeviceBindingId(id);

    expect(
      readDeviceBinding(
        createMockRequest({
          headers: { cookie: `${DEVICE_BINDING_COOKIE_NAME}=${value}` },
        }),
      ),
    ).toBeUndefined();
    expect(
      readDeviceBinding(
        createMockRequest({
          headers: { cookie: `${SECURE_DEVICE_BINDING_COOKIE_NAME}=${value}` },
        }),
      ),
    ).toEqual({ id });
  });
});

describe("writeDeviceBindingCookie", () => {
  it("writes a long-lived httpOnly cookie", () => {
    const recorder = createMockResponse();
    const id = createDeviceBindingId();

    writeDeviceBindingCookie(recorder.response, id);

    const header = String(recorder.headers()["set-cookie"]);
    expect(header).toContain(
      `${DEVICE_BINDING_COOKIE_NAME}=${encodeURIComponent(signDeviceBindingId(id))}`,
    );
    expect(header).toContain("Max-Age=34560000");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Secure");
  });

  it("writes the __Host- name, Secure, when cookies are secure", () => {
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      secureCookies: true,
    });
    const recorder = createMockResponse();

    writeDeviceBindingCookie(recorder.response, createDeviceBindingId());

    const header = String(recorder.headers()["set-cookie"]);
    expect(header).toContain(`${SECURE_DEVICE_BINDING_COOKIE_NAME}=`);
    expect(header).toContain("Secure");
  });
});

describe("toPublicClientContext", () => {
  it("drops the binding and keeps the rest", () => {
    const client: ClientRequestContext = {
      ip: "127.0.0.1",
      source: "frontend-browser",
      device: { id: "hint", type: "desktop", isMobile: false },
      deviceBinding: { id: createDeviceBindingId() },
    };

    expect(toPublicClientContext(client)).toEqual({
      ip: "127.0.0.1",
      source: "frontend-browser",
      device: { id: "hint", type: "desktop", isMobile: false },
    });
  });
});
