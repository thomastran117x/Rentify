import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OAuthAccountsService } from "@/features/auth/oauth/oauth-accounts.service";
import { OAuthController } from "@/features/auth/oauth/oauth.controller";
import { AppleOAuthService } from "@/features/auth/oauth/apple.service";
import { GoogleOAuthService } from "@/features/auth/oauth/google.service";
import { MicrosoftOAuthService } from "@/features/auth/oauth/microsoft.service";
import { OAuthTokenVerifier } from "@/features/auth/oauth/oauth-token-verifier";
import { OAuthIdentityRepository } from "@/features/auth/oauth/oauth-identity.repository";

export const authOauthRegistrationModule: ContainerRegistrationModule = {
  id: "auth-oauth",
  register(container) {
    container.register({
      token: containerTokens.authOAuthIdentityRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new OAuthIdentityRepository(),
    });
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
    container.register({
      token: containerTokens.oauthAccountsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authUsersRepository,
        containerTokens.authOAuthIdentityRepository,
        containerTokens.googleOAuthService,
        containerTokens.microsoftOAuthService,
        containerTokens.appleOAuthService,
        containerTokens.usernameBloomService,
        containerTokens.mfaTotpService,
        containerTokens.authSessionService,
      ],
      resolve: ({ resolve }) =>
        new OAuthAccountsService(
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.authOAuthIdentityRepository),
          resolve(containerTokens.googleOAuthService),
          resolve(containerTokens.microsoftOAuthService),
          resolve(containerTokens.appleOAuthService),
          resolve(containerTokens.usernameBloomService),
          resolve(containerTokens.mfaTotpService),
          resolve(containerTokens.authSessionService),
        ),
    });
    container.register({
      token: containerTokens.oauthController,
      lifetime: "scoped",
      dependencies: [containerTokens.oauthAccountsService],
      resolve: ({ resolve }) =>
        new OAuthController(resolve(containerTokens.oauthAccountsService)),
    });
  },
};
