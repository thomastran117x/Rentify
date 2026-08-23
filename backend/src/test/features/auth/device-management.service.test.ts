import BadRequestError from "@/errors/http/bad-request.error";
import type { AuthRequestContext, AuthUserRecord } from "@/features/auth/auth.model";
import { DeviceManagementService } from "@/features/auth/device/device-management.service";

function createUser(): AuthUserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 1,
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      id: "profile-1",
      userId: "user-1",
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
      sub: "user-1",
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
    revokeSessionsForDevice: jest.fn(async () => 1),
  };

  return {
    authRepository,
    deviceService,
    tokenService,
    service: new DeviceManagementService(
      authRepository as never,
      deviceService as never,
      tokenService as never,
    ),
  };
}

describe("DeviceManagementService.deviceVerify", () => {
  it("registers the device carried by the token", async () => {
    const harness = createHarness();

    await harness.service.deviceVerify(createContext());

    expect(harness.deviceService.registerKnownDevice).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
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
          sub: "user-1",
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

    await expect(harness.service.deviceVerify(createContext())).resolves.toEqual(
      {
        verified: true,
        device: {
          id: "device-1",
          type: "desktop",
          isMobile: false,
          known: true,
          knownByIp: true,
          deviceId: "device-1",
        },
        auth: { userId: "user-1", tokenDeviceId: "device-1" },
      },
    );
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
        },
      ],
    });
    expect(harness.deviceService.listKnownDevices).toHaveBeenCalledWith(
      "user-1",
      "device-1",
    );
  });
});

describe("DeviceManagementService.removeKnownDevice", () => {
  it("removes the device and revokes its active sessions", async () => {
    const harness = createHarness();

    await expect(
      harness.service.removeKnownDevice({
        userId: "user-1",
        deviceId: "device-2",
      }),
    ).resolves.toEqual({ removed: true, deviceId: "device-2" });

    expect(harness.deviceService.removeKnownDevice).toHaveBeenCalledWith(
      "user-1",
      "device-2",
    );
    // Leaving the sessions live would make "sign this device out" only remove it
    // from the list.
    expect(harness.tokenService.revokeSessionsForDevice).toHaveBeenCalledWith(
      "user-1",
      "device-2",
    );
  });
});
