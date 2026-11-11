import type { Request } from "express";
import {
  deviceBindingIssueMiddleware,
  deviceBindingMiddleware,
} from "@/configuration/middlewares/device-binding.middleware";
import {
  DEVICE_BINDING_COOKIE_NAME,
  signDeviceBindingId,
  verifyDeviceBindingCookieValue,
} from "@/features/auth/device/device-binding";
import { createMockRequest, createMockResponse } from "../../support/mock-http";

const BINDING_ID = "CCCCCCCCCCCCCCCCCCCCCC";

function requestWithCookie(cookie?: string): Request {
  return createMockRequest({
    headers: { "x-device-id": "client-hint", ...(cookie ? { cookie } : {}) },
    state: {
      client: {
        source: "frontend-browser",
        device: { id: "client-hint", type: "desktop", isMobile: false },
      },
    },
  });
}

function readIssuedId(header: unknown): string | undefined {
  const match = new RegExp(`${DEVICE_BINDING_COOKIE_NAME}=([^;]+)`).exec(
    String(header),
  );
  return match
    ? verifyDeviceBindingCookieValue(decodeURIComponent(match[1]!))
    : undefined;
}

describe("deviceBindingMiddleware", () => {
  it("attaches a verified binding and leaves the hint alone", () => {
    const request = requestWithCookie(
      `${DEVICE_BINDING_COOKIE_NAME}=${signDeviceBindingId(BINDING_ID)}`,
    );
    const next = jest.fn();

    deviceBindingMiddleware(request, createMockResponse().response, next);

    expect(request.client.deviceBinding).toEqual({ id: BINDING_ID });
    expect(request.client.device.id).toBe("client-hint");
    expect(next).toHaveBeenCalledWith();
  });

  it("attaches nothing for a missing or forged cookie", () => {
    for (const cookie of [
      undefined,
      `${DEVICE_BINDING_COOKIE_NAME}=${BINDING_ID}.${"A".repeat(43)}`,
    ]) {
      const request = requestWithCookie(cookie);
      const next = jest.fn();

      deviceBindingMiddleware(request, createMockResponse().response, next);

      expect(request.client.deviceBinding).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    }
  });
});

describe("deviceBindingIssueMiddleware", () => {
  it("hands a request without a binding a new signed cookie", () => {
    const request = requestWithCookie();
    const recorder = createMockResponse();
    const next = jest.fn();

    deviceBindingIssueMiddleware(request, recorder.response, next);

    expect(readIssuedId(recorder.headers()["set-cookie"])).toMatch(
      /^[A-Za-z0-9_-]{22}$/,
    );
    // Not counted until a request presents it.
    expect(request.client.deviceBinding).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it("leaves a presented binding as it is", () => {
    const request = requestWithCookie();
    request.client.deviceBinding = { id: BINDING_ID };
    const recorder = createMockResponse();
    const next = jest.fn();

    deviceBindingIssueMiddleware(request, recorder.response, next);

    expect(recorder.headers()["set-cookie"]).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
