import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { UsernameBloomRepository } from "@/features/auth/username-bloom/username-bloom.repository";
import { UsernameBloomService } from "@/features/auth/username-bloom/username-bloom.service";
import { UsernameBloomStore } from "@/features/auth/username-bloom/username-bloom.store";

export const usernameBloomRegistrationModule: ContainerRegistrationModule = {
  id: "username-bloom",
  register(container) {
    container.register({
      token: containerTokens.usernameBloomStore,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new UsernameBloomStore(),
    });
    container.register({
      token: containerTokens.usernameBloomRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new UsernameBloomRepository(),
    });
    container.register({
      token: containerTokens.usernameBloomService,
      // Singleton, not scoped: it owns the in-process bit array, a refresh
      // timer, and a dedicated Redis subscriber. A per-request copy would start
      // empty every time and open a connection per request.
      lifetime: "singleton",
      dependencies: [containerTokens.usernameBloomStore],
      resolve: ({ resolve }) =>
        new UsernameBloomService(
          resolve(containerTokens.usernameBloomStore),
          environment.getUsernameBloomConfig(),
          loggerFactory.forComponent("username-bloom", "service"),
        ),
      dispose: (service) => service.dispose(),
    });
  },
};
