import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { DeviceRepository } from "@/features/auth/device/device.repository";
import { DeviceService } from "@/features/auth/device/device.service";
import { DeviceManagementController } from "@/features/auth/device/device-management.controller";
import { DeviceManagementService } from "@/features/auth/device/device-management.service";

export const authDeviceRegistrationModule: ContainerRegistrationModule = {
  id: "auth-device",
  register(container) {
    container.register({
      token: containerTokens.deviceRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new DeviceRepository(),
    });
    container.register({
      token: containerTokens.deviceService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.deviceRepository,
        containerTokens.emailService,
        containerTokens.cacheService,
        containerTokens.authAuditService,
        containerTokens.selfLockTokenStore,
      ],
      resolve: ({ resolve }) =>
        new DeviceService({
          deviceRepository: resolve(containerTokens.deviceRepository),
          emailService: resolve(containerTokens.emailService),
          cache: resolve(containerTokens.cacheService),
          authAuditService: resolve(containerTokens.authAuditService),
          selfLockTokenStore: resolve(containerTokens.selfLockTokenStore),
        }),
    });
    container.register({
      token: containerTokens.deviceManagementService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authUsersRepository,
        containerTokens.deviceService,
        containerTokens.tokenService,
        containerTokens.authAuditService,
      ],
      resolve: ({ resolve }) =>
        new DeviceManagementService(
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.deviceService),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.authAuditService),
        ),
    });
    container.register({
      token: containerTokens.deviceManagementController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.deviceManagementService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new DeviceManagementController(
          resolve(containerTokens.deviceManagementService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
