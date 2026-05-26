import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AppleOAuthService } from "@/features/auth/oauth/apple.service";
import { GoogleOAuthService } from "@/features/auth/oauth/google.service";
import { MicrosoftOAuthService } from "@/features/auth/oauth/microsoft.service";
import { OAuthTokenVerifier } from "@/features/auth/oauth/oauth-token-verifier";

export const authOauthRegistrationModule: ContainerRegistrationModule = {
  id: "auth-oauth",
  register(container) {
    container.register({
      token: containerTokens.oauthTokenVerifier,
      lifetime: "transient",
      dependencies: [],
      resolve: () => new OAuthTokenVerifier(),
    });
    container.register({
      token: containerTokens.googleOAuthService,
      lifetime: "transient",
      dependencies: [containerTokens.oauthTokenVerifier],
      resolve: ({ resolve }) =>
        new GoogleOAuthService(resolve(containerTokens.oauthTokenVerifier)),
    });
    container.register({
      token: containerTokens.microsoftOAuthService,
      lifetime: "transient",
      dependencies: [containerTokens.oauthTokenVerifier],
      resolve: ({ resolve }) =>
        new MicrosoftOAuthService(resolve(containerTokens.oauthTokenVerifier)),
    });
    container.register({
      token: containerTokens.appleOAuthService,
      lifetime: "transient",
      dependencies: [],
      resolve: () => new AppleOAuthService(),
    });
  },
};
