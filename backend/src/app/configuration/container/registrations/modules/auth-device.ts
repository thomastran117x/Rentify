import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { DeviceRepository } from "@/features/auth/device/device.repository";
import { DeviceService } from "@/features/auth/device/device.service";

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
      ],
      resolve: ({ resolve }) =>
        new DeviceService({
          deviceRepository: resolve(containerTokens.deviceRepository),
          emailService: resolve(containerTokens.emailService),
          cache: resolve(containerTokens.cacheService),
        }),
    });
  },
};
