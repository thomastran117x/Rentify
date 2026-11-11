import BadRequestError from "@/errors/http/bad-request.error";
import type {
  AuthRequestContext,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import { DeviceManagementService } from "@/features/auth/device/device-management.service";
import { testUuid } from "../../support/uuid";

const NOW = new Date("2026-03-01T00:00:00.000Z");
const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);

function createUser(): AuthUserRecord {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 1,
    role: "user",
    status: "active",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      avatarVariants: null,
      id: PROFILE_1_ID,
      userId: USER_1_ID,
      username: "test-user",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 80,
      rentPostingsCount: 0,
      availableRentPostingsCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createContext(
  overrides: Partial<AuthRequestContext> = {},
): AuthRequestContext {
  return {
    auth: {
      authMethod: "jwt",
      sub: USER_1_ID,
      deviceId: "device-1",
      iat: 1,
      exp: 999_999,
    },
    client: {
      ip: "127.0.0.1",
      device: { id: "device-1", type: "desktop", isMobile: false },
    },
    ...overrides,
  } as AuthRequestContext;
}

function createHarness() {
  const authRepository = {
    findUserById: jest.fn(async () => createUser()),
  };
  const deviceService = {
    registerKnownDevice: jest.fn(async () => ({
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    })),
    listKnownDevices: jest.fn(async () => [
      {
        id: "known-device-1",
        current: true,
        deviceId: "device-1",
        type: "desktop",
        platform: "macOS",
        userAgent: "test-agent",
        lastIpAddress: "127.0.0.1",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-02T00:00:00.000Z",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
    removeKnownDevice: jest.fn(async () => undefined),
  };
  const tokenService = {
    revokeSessionsForDevice: jest.fn(async () => ["session-1"]),
  };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const deviceTrustService = { revoke: jest.fn(async () => true) };

  return {
    authRepository,
    deviceService,
    tokenService,
    authAuditService,
    deviceTrustService,
    service: new DeviceManagementService(
      authRepository as never,
      deviceService as never,
      tokenService as never,
      authAuditService as never,
      deviceTrustService,
      () => NOW,
    ),
  };
}

describe("DeviceManagementService.deviceVerify", () => {
  it("registers the device carried by the token", async () => {
    const harness = createHarness();

    await harness.service.deviceVerify(createContext());

    expect(harness.deviceService.registerKnownDevice).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_1_ID }),
      expect.anything(),
      "device-1",
    );
  });

  it("falls back to the fingerprinted device when the token carries none", async () => {
    const harness = createHarness();

    await harness.service.deviceVerify(
      createContext({
        auth: {
          authMethod: "jwt",
          sub: USER_1_ID,
          iat: 1,
          exp: 999_999,
        } as AuthRequestContext["auth"],
      }),
    );

    expect(harness.deviceService.registerKnownDevice).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "device-1",
    );
  });

  it("returns the device verdict alongside the principal", async () => {
    const harness = createHarness();

    await expect(
      harness.service.deviceVerify(createContext()),
    ).resolves.toEqual({
      verified: true,
      device: {
        id: "device-1",
        type: "desktop",
        isMobile: false,
        known: true,
        knownByIp: true,
        deviceId: "device-1",
      },
      auth: { userId: USER_1_ID, tokenDeviceId: "device-1" },
    });
  });

  it("rejects a token whose account no longer exists", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      null as unknown as AuthUserRecord,
    );

    await expect(harness.service.deviceVerify(createContext())).rejects.toThrow(
      BadRequestError,
    );
  });
});

describe("DeviceManagementService.devices", () => {
  it("lists known devices for the authenticated user", async () => {
    const harness = createHarness();

    await expect(harness.service.devices(createContext())).resolves.toEqual({
      devices: [
        {
          id: "known-device-1",
          current: true,
          deviceId: "device-1",
          type: "desktop",
          platform: "macOS",
          userAgent: "test-agent",
          lastIpAddress: "127.0.0.1",
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-02T00:00:00.000Z",
          verifiedAt: "2026-01-01T00:00:00.000Z",
          bound: false,
          trusted: false,
        },
      ],
    });
    expect(harness.deviceService.listKnownDevices).toHaveBeenCalledWith(
      USER_1_ID,
      "device-1",
    );
  });

  it("shows trust only while it is current for the account's token version", async () => {
    const harness = createHarness();
    const base = {
      current: false,
      type: "desktop",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-02T00:00:00.000Z",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      bindingId: "binding",
    };
    harness.deviceService.listKnownDevices.mockResolvedValue([
      {
        ...base,
        id: "trusted",
        deviceId: "trusted",
        trustedUntil: "2026-03-10T00:00:00.000Z",
        trustedTokenVersion: 1,
      },
      {
        ...base,
        id: "expired",
        deviceId: "expired",
        trustedUntil: "2026-02-28T00:00:00.000Z",
        trustedTokenVersion: 1,
      },
      // Trusted before a password change rotated the token version.
      {
        ...base,
        id: "rotated",
        deviceId: "rotated",
        trustedUntil: "2026-03-10T00:00:00.000Z",
        trustedTokenVersion: 0,
      },
    ] as never);

    const { devices } = await harness.service.devices(createContext());

    expect(
      devices.map(({ deviceId, bound, trusted, trustedUntil }) => ({
        deviceId,
        bound,
        trusted,
        trustedUntil,
      })),
    ).toEqual([
      {
        deviceId: "trusted",
        bound: true,
        trusted: true,
        trustedUntil: "2026-03-10T00:00:00.000Z",
      },
      {
        deviceId: "expired",
        bound: true,
        trusted: false,
        trustedUntil: undefined,
      },
      {
        deviceId: "rotated",
        bound: true,
        trusted: false,
        trustedUntil: undefined,
      },
    ]);
  });

  it("rejects a token whose account no longer exists", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(null as never);

    await expect(harness.service.devices(createContext())).rejects.toThrow();
    expect(harness.deviceService.listKnownDevices).not.toHaveBeenCalled();
  });
});

describe("DeviceManagementService.revokeDeviceTrust", () => {
  it("ends one device's trust and says whether it had any", async () => {
    const harness = createHarness();
    const audit = { requestId: "request-1" };

    await expect(
      harness.service.revokeDeviceTrust({
        userId: USER_1_ID,
        deviceId: "device-1",
        audit,
      }),
    ).resolves.toEqual({ revoked: true, deviceId: "device-1" });
    expect(harness.deviceTrustService.revoke).toHaveBeenCalledWith(
      USER_1_ID,
      "device-1",
      audit,
    );

    harness.deviceTrustService.revoke.mockResolvedValue(false);
    await expect(
      harness.service.revokeDeviceTrust({
        userId: USER_1_ID,
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ revoked: false, deviceId: "device-1" });
  });
});

describe("DeviceManagementService.removeKnownDevice", () => {
  it("removes the device and revokes its active sessions", async () => {
    const harness = createHarness();

    await expect(
      harness.service.removeKnownDevice({
        userId: USER_1_ID,
        deviceId: "device-2",
      }),
    ).resolves.toEqual({ removed: true, deviceId: "device-2" });

    expect(harness.deviceService.removeKnownDevice).toHaveBeenCalledWith(
      USER_1_ID,
      "device-2",
    );
    // Leaving the sessions live would make "sign this device out" only remove it
    // from the list.
    expect(harness.tokenService.revokeSessionsForDevice).toHaveBeenCalledWith(
      USER_1_ID,
      "device-2",
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "session.revoked",
      outcome: "success",
      userId: USER_1_ID,
      sessionId: "session-1",
      context: undefined,
      metadata: { source: "device" },
    });
  });

  it("records one event for every active session revoked", async () => {
    const harness = createHarness();
    harness.tokenService.revokeSessionsForDevice.mockResolvedValue([
      "session-1",
      "session-2",
    ]);

    await harness.service.removeKnownDevice({
      userId: USER_1_ID,
      deviceId: "device-2",
      audit: { requestId: "request-1" },
    });

    expect(harness.authAuditService.recordSafely).toHaveBeenCalledTimes(2);
    expect(harness.authAuditService.recordSafely).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: "session.revoked",
        sessionId: "session-2",
        context: { requestId: "request-1" },
      }),
    );
  });

  it("does not record a revocation when the device had no active sessions", async () => {
    const harness = createHarness();
    harness.tokenService.revokeSessionsForDevice.mockResolvedValue([]);

    await harness.service.removeKnownDevice({
      userId: USER_1_ID,
      deviceId: "device-2",
    });

    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
  });
});
