import MfaVerificationRequiredError from "@/errors/http/mfa-verification-required.error";
import { DeviceManagementController } from "@/features/auth/device/device-management.controller";
import type { DeviceManagementService } from "@/features/auth/device/device-management.service";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import {
  createClaims,
  createContext,
  invoke,
  type AuthTestContext,
} from "../../support/auth-controller-harness";
import { testUuid } from "../../support/uuid";

const USER_12_ID = testUuid(9000, 822527);
const USER_7_ID = testUuid(9000, 994263);

const mockRequireRecentMfaVerification = jest.fn();
const mockRequireRecentMfaVerificationForAnyScope = jest.fn();

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
  requireRecentMfaVerificationForAnyScope: (...args: unknown[]) =>
    mockRequireRecentMfaVerificationForAnyScope(...args),
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
    revokeDeviceTrust: jest.fn(async () => ({
      revoked: true,
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
  mockRequireRecentMfaVerification.mockResolvedValue(undefined);
  mockRequireRecentMfaVerificationForAnyScope.mockResolvedValue(undefined);
});

describe("DeviceManagementController.deviceVerify", () => {
  it("registers the calling device once the session has a proof", async () => {
    const auth = createClaims({
      sub: USER_7_ID,
      deviceId: "trusted-device-44",
    });
    const { controller, deviceManagementService } = createController();

    const response = await invoke(
      controller.deviceVerify,
      createContext({ auth }),
    );

    expect(deviceManagementService.deviceVerify).toHaveBeenCalledWith({
      auth,
      client: expect.any(Object),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Device verified successfully.",
    });
  });

  it("accepts a recent device-login or mfa-management proof", async () => {
    const { controller } = createController();

    await invoke(
      controller.deviceVerify,
      createContext({ auth: createClaims() }),
    );

    expect(mockRequireRecentMfaVerificationForAnyScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ["device-login", "mfa-management"],
    );
  });

  it("registers nothing without a proof", async () => {
    const { controller, deviceManagementService } = createController();
    mockRequireRecentMfaVerificationForAnyScope.mockRejectedValue(
      new MfaVerificationRequiredError(),
    );

    await expect(
      invoke(controller.deviceVerify, createContext({ auth: createClaims() })),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);

    expect(deviceManagementService.deviceVerify).not.toHaveBeenCalled();
  });
});

describe("DeviceManagementController.devices", () => {
  it("requires a recent MFA verification before listing", async () => {
    const auth = createClaims({ sub: USER_7_ID });
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

describe("DeviceManagementController.revokeDeviceTrust", () => {
  it("steps up, then ends the named device's trust", async () => {
    const auth = createClaims({ sub: USER_12_ID });
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, deviceManagementService } = createController();

    const response = await invoke(
      controller.revokeDeviceTrust,
      createContext({ body: { deviceId: "device-99" } }),
    );

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
    expect(deviceManagementService.revokeDeviceTrust).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_12_ID, deviceId: "device-99" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "Device is no longer trusted.",
      data: { revoked: true, deviceId: "device-99" },
    });
  });
});

describe("DeviceManagementController.removeKnownDevice", () => {
  it("steps up, then maps the body onto the authenticated user id", async () => {
    const auth = createClaims({ sub: USER_12_ID });
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
      userId: USER_12_ID,
      deviceId: "device-99",
      audit: {
        ipAddress: "127.0.0.1",
        deviceId: "device-99",
        userAgent: "test-agent",
        requestId: "request-test",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      message: "Known device removed successfully.",
      data: { removed: true, deviceId: "device-99" },
    });
  });

  it("rejects a body with no device id", async () => {
    const auth = createClaims({ sub: USER_12_ID });
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
