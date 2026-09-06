import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import {
  emailBloomSubject,
  usernameBloomSubject,
} from "@/features/auth/identity-bloom/identity-bloom-subject";
import { IdentityBloomService } from "@/features/auth/identity-bloom/identity-bloom.service";
import { IdentityBloomStore } from "@/features/auth/identity-bloom/identity-bloom.store";
import { EmailBloomSource } from "@/features/auth/identity-bloom/sources/email-bloom.source";
import { UsernameBloomSource } from "@/features/auth/identity-bloom/sources/username-bloom.source";

export const identityBloomRegistrationModule: ContainerRegistrationModule = {
  id: "identity-bloom",
  register(container) {
    container.register({
      token: containerTokens.identityBloomStore,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new IdentityBloomStore(),
    });
    container.register({
      token: containerTokens.usernameBloomSource,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new UsernameBloomSource(),
    });
    container.register({
      token: containerTokens.emailBloomSource,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new EmailBloomSource(),
    });
    container.register({
      token: containerTokens.usernameBloomService,
      // Singleton, not scoped: it owns the in-process bit array, a refresh
      // timer, and a dedicated Redis subscriber. A per-request copy would start
      // empty every time and open a connection per request.
      lifetime: "singleton",
      dependencies: [containerTokens.identityBloomStore],
      resolve: ({ resolve }) =>
        new IdentityBloomService(
          usernameBloomSubject,
          resolve(containerTokens.identityBloomStore),
          environment.getUsernameBloomConfig(),
          loggerFactory.forComponent("username-bloom", "service"),
        ),
      dispose: (service) => service.dispose(),
    });
    container.register({
      token: containerTokens.emailBloomService,
      // Separate instance rather than a second subject on one service: each
      // filter owns a bit array sized from its own capacity and a subscription
      // to its own channel, so they cannot share state even though they share
      // every line of code.
      lifetime: "singleton",
      dependencies: [containerTokens.identityBloomStore],
      resolve: ({ resolve }) =>
        new IdentityBloomService(
          emailBloomSubject,
          resolve(containerTokens.identityBloomStore),
          environment.getEmailBloomConfig(),
          loggerFactory.forComponent("email-bloom", "service"),
        ),
      dispose: (service) => service.dispose(),
    });
  },
};
