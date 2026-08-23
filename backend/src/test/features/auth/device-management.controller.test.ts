import { DeviceManagementController } from "@/features/auth/device/device-management.controller";
import type { DeviceManagementService } from "@/features/auth/device/device-management.service";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import {
  createClaims,
  createContext,
  invoke,
  type AuthTestContext,
} from "../../support/auth-controller-harness";

const mockRequireJwtAuth = jest.fn();
const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: jest.fn(),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

function createController() {
  const deviceManagementService = {
    deviceVerify: jest.fn(async () => ({
      verified: true,
      device: { id: "device-1", known: true, knownByIp: true },
      auth: { userId: "user-1" },
    })),
    devices: jest.fn(async () => ({ devices: [] })),
    removeKnownDevice: jest.fn(async () => ({
      removed: true,
      deviceId: "device-99",
    })),
  };
  const mfaVerificationService = {} as MfaVerificationService;

  return {
    deviceManagementService,
    controller: new DeviceManagementController(
      deviceManagementService as unknown as DeviceManagementService,
      mfaVerificationService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireJwtAuth.mockResolvedValue(createClaims());
  mockRequireRecentMfaVerification.mockResolvedValue(undefined);
});

describe("DeviceManagementController.deviceVerify", () => {
  it("authenticates, then registers the calling device", async () => {
    const auth = createClaims({ sub: "user-7", deviceId: "trusted-device-44" });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, deviceManagementService } = createController();

    const response = await invoke(
      controller.deviceVerify,
      createContext({ auth }),
    );

    expect(mockRequireJwtAuth).toHaveBeenCalled();
    expect(deviceManagementService.deviceVerify).toHaveBeenCalledWith({
      auth,
      client: expect.any(Object),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Device verified successfully.",
    });
  });

  it("does not require an MFA step-up", async () => {
    const { controller } = createController();

    await invoke(
      controller.deviceVerify,
      createContext({ auth: createClaims() }),
    );

    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
  });
});

describe("DeviceManagementController.devices", () => {
  it("requires a recent MFA verification before listing", async () => {
    const auth = createClaims({ sub: "user-7" });
    const { controller, deviceManagementService } = createController();

    const response = await invoke(controller.devices, createContext({ auth }));

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
    expect(deviceManagementService.devices).toHaveBeenCalledWith({
      auth,
      client: expect.any(Object),
    });
    expect(response.status).toBe(200);
  });

  it("does not call the service when the step-up fails", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new Error("step-up required"),
    );
    const { controller, deviceManagementService } = createController();

    await expect(
      invoke(controller.devices, createContext({ auth: createClaims() })),
    ).rejects.toThrow("step-up required");
    expect(deviceManagementService.devices).not.toHaveBeenCalled();
  });
});

describe("DeviceManagementController.removeKnownDevice", () => {
  it("steps up, then maps the body onto the authenticated user id", async () => {
    const auth = createClaims({ sub: "user-12" });
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, deviceManagementService } = createController();

    const response = await invoke(
      controller.removeKnownDevice,
      createContext({ body: { deviceId: "device-99" } }),
    );

    expect(deviceManagementService.removeKnownDevice).toHaveBeenCalledWith({
      userId: "user-12",
      deviceId: "device-99",
    });
    await expect(response.json()).resolves.toMatchObject({
      message: "Known device removed successfully.",
      data: { removed: true, deviceId: "device-99" },
    });
  });

  it("rejects a body with no device id", async () => {
    const auth = createClaims({ sub: "user-12" });
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, deviceManagementService } = createController();

    await expect(
      invoke(controller.removeKnownDevice, createContext({ body: {} })),
    ).rejects.toThrow();
    expect(deviceManagementService.removeKnownDevice).not.toHaveBeenCalled();
  });
});
