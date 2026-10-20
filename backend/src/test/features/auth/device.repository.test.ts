import { DeviceRepository } from "@/features/auth/device/device.repository";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 425301);

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
