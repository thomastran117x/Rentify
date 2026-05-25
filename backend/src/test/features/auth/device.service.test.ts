import BadRequestError from "@/errors/http/bad-request.error";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { DeviceService } from "@/features/auth/device/device.service";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { KnownDeviceRecord } from "@/features/auth/device/device.repository";

function createUser(): AuthUserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hashed-password",
    tokenVersion: 2,
    firstName: "Test",
    lastName: "User",
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    profile: {
      id: "profile-1",
      userId: "user-1",
      username: "test-user",
      phoneNumber: undefined,
      avatarUrl: undefined,
      avatarBlobName: undefined,
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

function createClient(
  overrides?: Partial<ClientRequestContext>,
): ClientRequestContext {
  return {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "test-agent",
      platform: "macOS",
    },
    ...overrides,
  };
}

function createKnownDevice(
  overrides?: Partial<KnownDeviceRecord>,
): KnownDeviceRecord {
  return {
    id: "known-device-1",
    userId: "user-1",
    deviceId: "device-1",
    type: "desktop",
    platform: "macOS",
    userAgent: "test-agent",
    lastIpAddress: "127.0.0.1",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createService(overrides?: {
  findKnownDevice?: (
    userId: string,
    deviceId: string,
  ) => Promise<KnownDeviceRecord | null>;
  touchKnownDevice?: (
    userId: string,
    deviceId: string,
    ipAddress?: string,
  ) => Promise<void>;
  hasKnownIpAddress?: (userId: string, ipAddress: string) => Promise<boolean>;
  hasAnyKnownDevice?: (userId: string) => Promise<boolean>;
  touchKnownIpAddress?: (userId: string, ipAddress: string) => Promise<void>;
  registerKnownDevice?: (input: {
    userId: string;
    deviceId: string;
    type: string;
    platform?: string;
    userAgent?: string;
    ipAddress?: string;
  }) => Promise<KnownDeviceRecord>;
  listKnownDevices?: (userId: string) => Promise<KnownDeviceRecord[]>;
  removeKnownDevice?: (userId: string, deviceId: string) => Promise<boolean>;
  cacheExists?: (key: string) => Promise<boolean>;
  cacheSet?: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  sendNewDeviceEmail?: (input: {
    to: string;
    firstName?: string;
    deviceLabel: string;
    ipAddress?: string;
    platform?: string;
    userAgent?: string;
    detectedAt: Date;
  }) => Promise<void>;
  unknownDeviceAlertCooldownInSeconds?: number;
}) {
  const deviceRepository = {
    findKnownDevice: jest.fn(overrides?.findKnownDevice ?? (async () => null)),
    touchKnownDevice: jest.fn(overrides?.touchKnownDevice ?? (async () => {})),
    hasKnownIpAddress: jest.fn(
      overrides?.hasKnownIpAddress ?? (async () => false),
    ),
    hasAnyKnownDevice: jest.fn(
      overrides?.hasAnyKnownDevice ?? (async () => true),
    ),
    touchKnownIpAddress: jest.fn(
      overrides?.touchKnownIpAddress ?? (async () => {}),
    ),
    registerKnownDevice: jest.fn(
      overrides?.registerKnownDevice ??
        (async (input) =>
          createKnownDevice({
            userId: input.userId,
            deviceId: input.deviceId,
            type: input.type,
            platform: input.platform,
            userAgent: input.userAgent,
            lastIpAddress: input.ipAddress,
          })),
    ),
    listKnownDevices: jest.fn(
      overrides?.listKnownDevices ??
        (async () => [
          createKnownDevice(),
          createKnownDevice({ id: "known-device-2", deviceId: "device-2" }),
        ]),
    ),
    removeKnownDevice: jest.fn(
      overrides?.removeKnownDevice ?? (async () => true),
    ),
  };
  const emailService = {
    sendNewDeviceEmail: jest.fn(
      overrides?.sendNewDeviceEmail ?? (async () => {}),
    ),
  };
  const cache = {
    exists: jest.fn(overrides?.cacheExists ?? (async () => false)),
    set: jest.fn(overrides?.cacheSet ?? (async () => {})),
  };
  const service = new DeviceService({
    deviceRepository: deviceRepository as never,
    emailService: emailService as never,
    cache: cache as never,
    unknownDeviceAlertCooldownInSeconds:
      overrides?.unknownDeviceAlertCooldownInSeconds,
  });

  return {
    service,
    deviceRepository,
    emailService,
    cache,
  };
}

describe("DeviceService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("registers a known device and returns a trusted device status", async () => {
    const { service, deviceRepository } = createService();

    const result = await service.registerKnownDevice(
      createUser(),
      createClient(),
      "device-9",
    );

    expect(result).toEqual({
      deviceId: "device-9",
      known: true,
      knownByIp: true,
    });
    expect(deviceRepository.registerKnownDevice).toHaveBeenCalledWith({
      userId: "user-1",
      deviceId: "device-9",
      type: "desktop",
      platform: "macOS",
      userAgent: "test-agent",
      ipAddress: "127.0.0.1",
    });
  });

  it("returns an unknown status when registering without a device id", async () => {
    const { service, deviceRepository } = createService();

    const result = await service.registerKnownDevice(
      createUser(),
      createClient(),
      undefined,
    );

    expect(result).toEqual({
      deviceId: undefined,
      known: false,
      knownByIp: false,
    });
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
  });

  it("marks authentication as known when the exact device has been seen before", async () => {
    const { service, deviceRepository, emailService } = createService({
      findKnownDevice: async () => createKnownDevice(),
    });

    const result = await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient(),
      "device-1",
    );

    expect(result).toEqual({
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    });
    expect(deviceRepository.touchKnownDevice).toHaveBeenCalledWith(
      "user-1",
      "device-1",
      "127.0.0.1",
    );
    expect(deviceRepository.hasKnownIpAddress).not.toHaveBeenCalled();
    expect(emailService.sendNewDeviceEmail).not.toHaveBeenCalled();
  });

  it("keeps authentication unknown when only the ip address has been seen before", async () => {
    const { service, deviceRepository, emailService } = createService({
      hasKnownIpAddress: async () => true,
    });

    const result = await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient(),
      "device-2",
    );

    expect(result).toEqual({
      deviceId: "device-2",
      known: false,
      knownByIp: true,
    });
    expect(deviceRepository.findKnownDevice).toHaveBeenCalledWith(
      "user-1",
      "device-2",
    );
    expect(deviceRepository.hasKnownIpAddress).toHaveBeenCalledWith(
      "user-1",
      "127.0.0.1",
    );
    expect(deviceRepository.touchKnownIpAddress).toHaveBeenCalledWith(
      "user-1",
      "127.0.0.1",
    );
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
    expect(emailService.sendNewDeviceEmail).not.toHaveBeenCalled();
  });

  it("skips device registration but still trusts a known ip when no device id is provided", async () => {
    const { service, deviceRepository } = createService({
      hasKnownIpAddress: async () => true,
    });

    const result = await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient(),
      undefined,
    );

    expect(result).toEqual({
      deviceId: undefined,
      known: false,
      knownByIp: true,
    });
    expect(deviceRepository.touchKnownIpAddress).toHaveBeenCalledWith(
      "user-1",
      "127.0.0.1",
    );
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
  });

  it("treats authentication as unknown when the client ip is missing", async () => {
    const { service, deviceRepository, emailService } = createService();

    const result = await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient({
        ip: undefined,
      }),
      "device-1",
    );

    expect(result).toEqual({
      deviceId: "device-1",
      known: false,
      knownByIp: false,
    });
    expect(deviceRepository.hasKnownIpAddress).not.toHaveBeenCalled();
    expect(emailService.sendNewDeviceEmail).not.toHaveBeenCalled();
  });

  it("sends a new-device alert and fail-closes trust for unknown ip addresses", async () => {
    const { service, cache, emailService } = createService({
      cacheExists: async () => false,
      unknownDeviceAlertCooldownInSeconds: 1800,
    });

    const result = await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient(),
      "new-device",
    );

    expect(result).toEqual({
      deviceId: "new-device",
      known: false,
      knownByIp: false,
    });
    expect(cache.exists).toHaveBeenCalledWith(
      "auth:unknown-device:user-1:new-device",
    );
    expect(cache.set).toHaveBeenCalledWith(
      "auth:unknown-device:user-1:new-device",
      "1",
      1800,
    );
    expect(emailService.sendNewDeviceEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      firstName: "Test",
      deviceLabel: "new-device",
      ipAddress: "127.0.0.1",
      platform: "macOS",
      userAgent: "test-agent",
      detectedAt: expect.any(Date),
    });
  });

  it("does not auto-register unseen devices during existing-session evaluation", async () => {
    const { service, deviceRepository, emailService } = createService({
      hasKnownIpAddress: async () => false,
      hasAnyKnownDevice: async () => true,
    });

    const result = await service.evaluateExistingSessionDevice(
      createUser(),
      createClient(),
      "new-session-device",
    );

    expect(result).toEqual({
      deviceId: "new-session-device",
      known: false,
      knownByIp: false,
    });
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
    expect(emailService.sendNewDeviceEmail).toHaveBeenCalledTimes(1);
  });

  it("skips unknown-device alerts for brand-new users during existing-session evaluation", async () => {
    const { service, emailService, deviceRepository } = createService({
      hasKnownIpAddress: async () => false,
      hasAnyKnownDevice: async () => false,
    });

    const result = await service.evaluateExistingSessionDevice(
      createUser(),
      createClient(),
      "brand-new-device",
    );

    expect(result).toEqual({
      deviceId: "brand-new-device",
      known: false,
      knownByIp: false,
    });
    expect(emailService.sendNewDeviceEmail).not.toHaveBeenCalled();
    expect(deviceRepository.registerKnownDevice).not.toHaveBeenCalled();
  });

  it("suppresses duplicate unknown-device alerts during the cooldown window", async () => {
    const { service, cache, emailService } = createService({
      cacheExists: async () => true,
    });

    const result = await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient(),
      "device-77",
    );

    expect(result).toEqual({
      deviceId: "device-77",
      known: false,
      knownByIp: false,
    });
    expect(cache.set).not.toHaveBeenCalled();
    expect(emailService.sendNewDeviceEmail).not.toHaveBeenCalled();
  });

  it("falls back to an unknown-device label when alerting without a device id", async () => {
    const { service, cache, emailService } = createService();

    await service.evaluateSuccessfulAuthentication(
      createUser(),
      createClient(),
      undefined,
    );

    expect(cache.exists).toHaveBeenCalledWith(
      "auth:unknown-device:user-1:unknown-device",
    );
    expect(emailService.sendNewDeviceEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceLabel: "unknown-device",
      }),
    );
  });

  it("marks the current device when listing known devices", async () => {
    const { service } = createService();

    await expect(
      service.listKnownDevices("user-1", "device-2"),
    ).resolves.toEqual([
      {
        ...createKnownDevice(),
        current: false,
      },
      {
        ...createKnownDevice({
          id: "known-device-2",
          deviceId: "device-2",
        }),
        current: true,
      },
    ]);
  });

  it("throws when removing a device that does not exist", async () => {
    const { service } = createService({
      removeKnownDevice: async () => false,
    });

    await expect(
      service.removeKnownDevice("user-1", "missing-device"),
    ).rejects.toMatchObject<Partial<BadRequestError>>({
      message: "Known device could not be found.",
    });
  });

  it("resolves cleanly when a known device is removed", async () => {
    const { service, deviceRepository } = createService({
      removeKnownDevice: async () => true,
    });

    await expect(
      service.removeKnownDevice("user-1", "device-1"),
    ).resolves.toBeUndefined();
    expect(deviceRepository.removeKnownDevice).toHaveBeenCalledWith(
      "user-1",
      "device-1",
    );
  });
});
