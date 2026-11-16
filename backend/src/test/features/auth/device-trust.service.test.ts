import BadRequestError from "@/errors/http/bad-request.error";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import type { KnownDeviceRecord } from "@/features/auth/device/device.repository";
import {
  DeviceTrustService,
  isDeviceTrustActive,
} from "@/features/auth/device/device-trust.service";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 610001);
const ROW_ID = testUuid(9000, 610002);
const BINDING_ID = "FFFFFFFFFFFFFFFFFFFFFF";
const NOW = new Date("2026-03-01T00:00:00.000Z");
const AUDIT = { requestId: "request-1" };

const USER = {
  id: USER_ID,
  tokenVersion: 4,
  mfaFactorVersion: 2,
} as AuthUserRecord;

/** Trust granted at the account's current versions, until the given time. */
const CURRENT_TRUST = {
  trustedTokenVersion: 4,
  trustedMfaVersion: 2,
};

function client(bound = true): ClientRequestContext {
  return {
    ip: "203.0.113.9",
    source: "frontend-browser",
    device: {
      id: "hint-1",
      type: "desktop",
      isMobile: false,
      userAgent: "agent",
      platform: "macOS",
    },
    ...(bound ? { deviceBinding: { id: BINDING_ID } } : {}),
  };
}

function device(overrides: Partial<KnownDeviceRecord> = {}): KnownDeviceRecord {
  return {
    id: ROW_ID,
    userId: USER_ID,
    deviceId: "hint-1",
    type: "desktop",
    bindingId: BINDING_ID,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createService() {
  const deviceRepository = {
    findByBindingId: jest.fn(
      async (): Promise<KnownDeviceRecord | null> => null,
    ),
    registerKnownDevice: jest.fn(async () => device()),
    revokeTrust: jest.fn(
      async (): Promise<KnownDeviceRecord | null> =>
        device({ trustedUntil: "2026-03-20T00:00:00.000Z", ...CURRENT_TRUST }),
    ),
  };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const service = new DeviceTrustService({
    deviceRepository,
    authAuditService,
    getTtlDays: () => 30,
    now: () => NOW,
  });

  return { service, deviceRepository, authAuditService };
}

describe("isDeviceTrustActive", () => {
  const account = { tokenVersion: 4, mfaFactorVersion: 2 };

  it.each([
    ["in force", "2026-03-02T00:00:00.000Z", 4, 2, true],
    ["lapsed", "2026-02-28T00:00:00.000Z", 4, 2, false],
    [
      "granted before a token rotation",
      "2026-03-02T00:00:00.000Z",
      3,
      2,
      false,
    ],
    ["granted before a factor change", "2026-03-02T00:00:00.000Z", 4, 1, false],
    ["never granted", undefined, undefined, undefined, false],
  ])(
    "is %s",
    (
      _label,
      trustedUntil,
      trustedTokenVersion,
      trustedMfaVersion,
      expected,
    ) => {
      expect(
        isDeviceTrustActive(
          { trustedUntil, trustedTokenVersion, trustedMfaVersion },
          account,
          NOW,
        ),
      ).toBe(expected);
    },
  );

  it("treats an account record without a factor version as version 0", () => {
    expect(
      isDeviceTrustActive(
        {
          trustedUntil: "2026-03-02T00:00:00.000Z",
          trustedTokenVersion: 4,
          trustedMfaVersion: 0,
        },
        { tokenVersion: 4 },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("DeviceTrustService.findTrust", () => {
  it("finds the trust of the device the cookie names", async () => {
    const { service, deviceRepository } = createService();
    deviceRepository.findByBindingId.mockResolvedValue(
      device({ trustedUntil: "2026-03-20T00:00:00.000Z", ...CURRENT_TRUST }),
    );

    await expect(service.findTrust(USER, client())).resolves.toEqual({
      trustedUntil: "2026-03-20T00:00:00.000Z",
    });
    expect(deviceRepository.findByBindingId).toHaveBeenCalledWith(
      USER_ID,
      BINDING_ID,
    );
  });

  it("finds none without a device cookie, whatever the hint", async () => {
    const { service, deviceRepository } = createService();

    await expect(service.findTrust(USER, client(false))).resolves.toBeNull();
    expect(deviceRepository.findByBindingId).not.toHaveBeenCalled();
  });

  it("finds none for an untrusted, lapsed, rotated or pre-factor-change device", async () => {
    const { service, deviceRepository } = createService();

    for (const row of [
      null,
      device(),
      device({ trustedUntil: "2026-02-01T00:00:00.000Z", ...CURRENT_TRUST }),
      device({
        trustedUntil: "2026-03-20T00:00:00.000Z",
        ...CURRENT_TRUST,
        trustedTokenVersion: 1,
      }),
      device({
        trustedUntil: "2026-03-20T00:00:00.000Z",
        ...CURRENT_TRUST,
        trustedMfaVersion: 1,
      }),
    ]) {
      deviceRepository.findByBindingId.mockResolvedValue(row);
      await expect(service.findTrust(USER, client())).resolves.toBeNull();
    }
  });
});

describe("DeviceTrustService.trust", () => {
  it("binds and trusts the device in one write, at the account's versions", async () => {
    const { service, deviceRepository, authAuditService } = createService();

    await expect(
      service.trust(USER, client(), "hint-1", AUDIT),
    ).resolves.toEqual({ trustedUntil: "2026-03-31T00:00:00.000Z" });
    expect(deviceRepository.registerKnownDevice).toHaveBeenCalledTimes(1);
    expect(deviceRepository.registerKnownDevice).toHaveBeenCalledWith({
      userId: USER_ID,
      deviceId: "hint-1",
      type: "desktop",
      platform: "macOS",
      userAgent: "agent",
      ipAddress: "203.0.113.9",
      bindingId: BINDING_ID,
      trust: {
        trustedUntil: new Date("2026-03-31T00:00:00.000Z"),
        tokenVersion: 4,
        mfaFactorVersion: 2,
      },
    });
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "device.trusted",
      outcome: "success",
      userId: USER_ID,
      context: AUDIT,
      metadata: { trustedUntil: "2026-03-31T00:00:00.000Z" },
    });
  });

  it("pins trust to factor version 0 for a record that carries none", async () => {
    const { service, deviceRepository } = createService();

    await service.trust(
      { id: USER_ID, tokenVersion: 4 } as AuthUserRecord,
      client(),
      "hint-1",
    );

    expect(deviceRepository.registerKnownDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        trust: expect.objectContaining({ mfaFactorVersion: 0 }),
      }),
    );
  });

  it("trusts nothing without a device id for the row and sessions to share", async () => {
    const { service, deviceRepository } = createService();

    await expect(service.trust(USER, client(), undefined)).resolves.toBeNull();
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
  });

  it("trusts nothing for a client without a device cookie", async () => {
    const { service, deviceRepository, authAuditService } = createService();

    await expect(
      service.trust(USER, client(false), "hint-1"),
    ).resolves.toBeNull();
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
    expect(authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("swallows a failure when trusting safely", async () => {
    const { service, deviceRepository } = createService();
    deviceRepository.registerKnownDevice.mockRejectedValue(
      new Error("db down"),
    );

    await expect(
      service.trustSafely(USER, client(), "hint-1"),
    ).resolves.toBeNull();
  });

  it("reads the TTL it was given", () => {
    expect(createService().service.ttlDays()).toBe(30);
  });

  it("defaults the TTL to the configured one", () => {
    const service = new DeviceTrustService({
      deviceRepository: {} as never,
      authAuditService: {} as never,
    });

    expect(service.ttlDays()).toBe(30);
  });
});

describe("DeviceTrustService.revoke", () => {
  it("ends trust that was in force and audits it", async () => {
    const { service, deviceRepository, authAuditService } = createService();

    await expect(service.revoke(USER, "hint-1", AUDIT)).resolves.toBe(true);
    expect(deviceRepository.revokeTrust).toHaveBeenCalledWith(
      USER_ID,
      "hint-1",
    );
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "device.trust_revoked",
      outcome: "success",
      userId: USER_ID,
      context: AUDIT,
      metadata: { reason: "user", scope: "one" },
    });
  });

  it("clears stale trust without counting or auditing it", async () => {
    const { service, deviceRepository, authAuditService } = createService();

    for (const previous of [
      device(),
      device({ trustedUntil: "2026-02-01T00:00:00.000Z", ...CURRENT_TRUST }),
      device({
        trustedUntil: "2026-03-20T00:00:00.000Z",
        ...CURRENT_TRUST,
        trustedMfaVersion: 1,
      }),
    ]) {
      deviceRepository.revokeTrust.mockResolvedValue(previous);
      await expect(service.revoke(USER, "hint-1")).resolves.toBe(false);
    }
    expect(authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("refuses a device the account does not have", async () => {
    const { service, deviceRepository } = createService();
    deviceRepository.revokeTrust.mockResolvedValue(null);

    await expect(service.revoke(USER, "missing")).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});

describe("DeviceTrustService.recordFactorChangeRevocation", () => {
  it("audits the trust a factor change ended", async () => {
    const { service, authAuditService } = createService();

    await service.recordFactorChangeRevocation(
      USER_ID,
      "mfa_disabled",
      2,
      AUDIT,
    );

    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "device.trust_revoked",
      outcome: "success",
      userId: USER_ID,
      context: AUDIT,
      metadata: { reason: "mfa_disabled", scope: "all", count: 2 },
    });
  });

  it("audits nothing when no device had trust in force", async () => {
    const { service, authAuditService } = createService();

    await service.recordFactorChangeRevocation(USER_ID, "passkey_added", 0);

    expect(authAuditService.recordSafely).not.toHaveBeenCalled();
  });
});
