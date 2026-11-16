import { Prisma } from "@/generated/prisma/client";
import { DeviceRepository } from "@/features/auth/device/device.repository";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 425301);
const ROW_ID = testUuid(9000, 425302);
const BINDING_ID = "DDDDDDDDDDDDDDDDDDDDDD";

function deviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    userId: USER_ID,
    deviceId: "hint-1",
    type: "desktop",
    platform: null,
    userAgent: null,
    lastIpAddress: "127.0.0.1",
    bindingId: null,
    firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-01-02T00:00:00.000Z"),
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const REGISTRATION = {
  userId: USER_ID,
  deviceId: "hint-1",
  type: "desktop",
  ipAddress: "127.0.0.1",
};

describe("DeviceRepository.listKnownDeviceIds", () => {
  it("reads only the device ids of the user's registered devices", async () => {
    const findMany = jest.fn(async () => [
      { deviceId: "device-1" },
      { deviceId: "device-2" },
    ]);
    const repository = new DeviceRepository({ device: { findMany } } as any);

    await expect(repository.listKnownDeviceIds(USER_ID)).resolves.toEqual([
      "device-1",
      "device-2",
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { deviceId: true },
    });
  });
});

describe("DeviceRepository.findByBindingId", () => {
  it("looks a device up by its account and binding", async () => {
    const findUnique = jest.fn(async () =>
      deviceRow({ bindingId: BINDING_ID }),
    );
    const repository = new DeviceRepository({ device: { findUnique } } as any);

    await expect(
      repository.findByBindingId(USER_ID, BINDING_ID),
    ).resolves.toMatchObject({ id: ROW_ID, bindingId: BINDING_ID });
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_bindingId: { userId: USER_ID, bindingId: BINDING_ID } },
    });
  });

  it("returns null when no device holds the binding", async () => {
    const repository = new DeviceRepository({
      device: { findUnique: jest.fn(async () => null) },
    } as any);

    await expect(
      repository.findByBindingId(USER_ID, BINDING_ID),
    ).resolves.toBeNull();
  });
});

describe("DeviceRepository.registerKnownDevice", () => {
  it("updates the row that already holds the binding", async () => {
    const update = jest.fn(async () =>
      deviceRow({ bindingId: BINDING_ID, deviceId: "old-hint" }),
    );
    const upsert = jest.fn();
    const repository = new DeviceRepository({
      device: {
        findUnique: jest.fn(async () =>
          deviceRow({ bindingId: BINDING_ID, deviceId: "old-hint" }),
        ),
        update,
        upsert,
      },
    } as any);

    await expect(
      repository.registerKnownDevice({
        ...REGISTRATION,
        bindingId: BINDING_ID,
      }),
    ).resolves.toMatchObject({ deviceId: "old-hint", bindingId: BINDING_ID });
    expect(update).toHaveBeenCalledWith({
      where: { id: ROW_ID },
      data: expect.objectContaining({
        type: "desktop",
        lastIpAddress: "127.0.0.1",
        verifiedAt: expect.any(Date),
      }),
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("binds the hint row when no row holds the binding yet", async () => {
    const upsert = jest.fn(async () => deviceRow({ bindingId: BINDING_ID }));
    const repository = new DeviceRepository({
      device: { findUnique: jest.fn(async () => null), upsert },
    } as any);

    await repository.registerKnownDevice({
      ...REGISTRATION,
      bindingId: BINDING_ID,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_deviceId: { userId: USER_ID, deviceId: "hint-1" } },
        create: expect.objectContaining({ bindingId: BINDING_ID }),
        // Trust granted to another cookie does not carry over.
        update: expect.objectContaining({
          bindingId: BINDING_ID,
          trustedUntil: null,
          trustedTokenVersion: null,
        }),
      }),
    );
  });

  it("updates the winner's row when a concurrent registration took the binding", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(deviceRow({ bindingId: BINDING_ID }));
    const upsert = jest.fn().mockRejectedValueOnce(duplicate);
    const update = jest.fn(async () => deviceRow({ bindingId: BINDING_ID }));
    const repository = new DeviceRepository({
      device: { findUnique, upsert, update },
    } as any);

    await expect(
      repository.registerKnownDevice({
        ...REGISTRATION,
        bindingId: BINDING_ID,
      }),
    ).resolves.toMatchObject({ bindingId: BINDING_ID });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ROW_ID } }),
    );
  });

  it("gives up after one retry, and on any other failure", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const repository = new DeviceRepository({
      device: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => {
          throw duplicate;
        }),
      },
    } as any);

    await expect(
      repository.registerKnownDevice({
        ...REGISTRATION,
        bindingId: BINDING_ID,
      }),
    ).rejects.toBe(duplicate);

    const failing = new DeviceRepository({
      device: {
        upsert: jest.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as any);
    await expect(failing.registerKnownDevice(REGISTRATION)).rejects.toThrow(
      "db down",
    );
  });

  it("leaves the binding untouched for a registration without one", async () => {
    const findUnique = jest.fn();
    const upsert = jest.fn(async () => deviceRow());
    const repository = new DeviceRepository({
      device: { findUnique, upsert },
    } as any);

    await expect(
      repository.registerKnownDevice(REGISTRATION),
    ).resolves.toMatchObject({ bindingId: undefined });
    expect(findUnique).not.toHaveBeenCalled();
    const [call] = upsert.mock.calls[0] as unknown as [
      { create: object; update: object },
    ];
    expect(call.create).not.toHaveProperty("bindingId");
    expect(call.update).not.toHaveProperty("bindingId");
  });
});

describe("DeviceRepository.findByDeviceId", () => {
  it("looks a device up by its account and client device id", async () => {
    const findUnique = jest.fn(async () => deviceRow());
    const repository = new DeviceRepository({ device: { findUnique } } as any);

    await expect(
      repository.findByDeviceId(USER_ID, "hint-1"),
    ).resolves.toMatchObject({ id: ROW_ID, deviceId: "hint-1" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_deviceId: { userId: USER_ID, deviceId: "hint-1" } },
    });

    findUnique.mockResolvedValue(null as never);
    await expect(
      repository.findByDeviceId(USER_ID, "missing"),
    ).resolves.toBeNull();
  });
});

describe("DeviceRepository.bindUnboundDevice", () => {
  it("binds only a row that has no binding yet", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const repository = new DeviceRepository({ device: { updateMany } } as any);

    await expect(
      repository.bindUnboundDevice(ROW_ID, BINDING_ID),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ROW_ID, bindingId: null },
      data: { bindingId: BINDING_ID },
    });

    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.bindUnboundDevice(ROW_ID, BINDING_ID),
    ).resolves.toBe(false);
  });

  it("reports false when the account already holds the binding", async () => {
    const repository = new DeviceRepository({
      device: {
        updateMany: jest.fn(async () => {
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
          });
        }),
      },
    } as any);

    await expect(
      repository.bindUnboundDevice(ROW_ID, BINDING_ID),
    ).resolves.toBe(false);
  });

  it("rethrows any other failure", async () => {
    const repository = new DeviceRepository({
      device: {
        updateMany: jest.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as any);

    await expect(
      repository.bindUnboundDevice(ROW_ID, BINDING_ID),
    ).rejects.toThrow("db down");
  });
});

describe("DeviceRepository.touchKnownDevice", () => {
  it("moves last seen forward, and the IP when there is one", async () => {
    const update = jest.fn(async () => deviceRow());
    const repository = new DeviceRepository({ device: { update } } as any);

    await repository.touchKnownDevice(ROW_ID, "10.0.0.1");
    await repository.touchKnownDevice(ROW_ID);

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: ROW_ID },
      data: { lastSeenAt: expect.any(Date), lastIpAddress: "10.0.0.1" },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: ROW_ID },
      data: { lastSeenAt: expect.any(Date) },
    });
  });
});
