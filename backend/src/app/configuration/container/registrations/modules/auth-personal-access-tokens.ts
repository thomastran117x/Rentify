import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import { PersonalAccessTokenRepository } from "@/features/auth/personal-access-token/personal-access-token.repository";
import { PersonalAccessTokenService } from "@/features/auth/personal-access-token/personal-access-token.service";

export const authPersonalAccessTokensRegistrationModule: ContainerRegistrationModule =
  {
    id: "auth-personal-access-tokens",
    register(container) {
      container.register({
        token: containerTokens.personalAccessTokenRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new PersonalAccessTokenRepository(),
      });
      container.register({
        token: containerTokens.personalAccessTokenService,
        lifetime: "singleton",
        dependencies: [containerTokens.personalAccessTokenRepository],
        resolve: ({ resolve }) =>
          new PersonalAccessTokenService(
            resolve(containerTokens.personalAccessTokenRepository),
          ),
      });
      container.register({
        token: containerTokens.personalAccessTokenController,
        lifetime: "scoped",
        dependencies: [containerTokens.personalAccessTokenService],
        resolve: ({ resolve }) =>
          new PersonalAccessTokenController(
            resolve(containerTokens.personalAccessTokenService),
          ),
      });
    },
  };
