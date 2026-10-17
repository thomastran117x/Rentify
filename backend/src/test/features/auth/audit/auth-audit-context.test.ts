import type { Request } from "express";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";

function createRequest(overrides: Partial<Request> = {}): Request {
  return {
    requestId: "request-1",
    client: {
      ip: "203.0.113.7",
      source: "frontend-browser",
      device: {
        id: "fingerprint-device",
        type: "desktop",
        isMobile: false,
        userAgent: "Mozilla/5.0",
      },
    },
    ...overrides,
  } as Request;
}

describe("toAuthAuditContext", () => {
  it("reads the resolved client context and request id", () => {
    expect(toAuthAuditContext(createRequest())).toEqual({
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      deviceId: "fingerprint-device",
      requestId: "request-1",
    });
  });

  it("prefers an explicit device id over the fingerprinted one", () => {
    expect(toAuthAuditContext(createRequest(), "body-device").deviceId).toBe(
      "body-device",
    );
  });

  it("leaves fields empty when the request carries no client context", () => {
    expect(
      toAuthAuditContext(createRequest({ client: undefined } as never)),
    ).toEqual({
      ipAddress: undefined,
      userAgent: undefined,
      deviceId: undefined,
      requestId: "request-1",
    });
  });
});
