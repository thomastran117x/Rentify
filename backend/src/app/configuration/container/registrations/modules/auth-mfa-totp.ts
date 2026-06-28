import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { environment } from "@/configuration/environment";
import { MfaTotpController } from "@/features/auth/mfa/totp/mfa-totp.controller";
import { MfaTotpRepository } from "@/features/auth/mfa/totp/mfa-totp.repository";
import { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { TotpService } from "@/features/auth/mfa/totp/totp.service";

export const authMfaTotpRegistrationModule: ContainerRegistrationModule = {
  id: "auth-mfa-totp",
  register(container) {
    const authConfig = environment.getTokenConfig();
    const encryptionKey = Buffer.from(authConfig.mfaTotpEncryptionKey, "hex");

    container.register({
      token: containerTokens.totpService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () =>
        new TotpService({
          issuer: process.env.APP_NAME ?? "Rent",
        }),
    });
    container.register({
      token: containerTokens.mfaTotpRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new MfaTotpRepository(),
    });
    container.register({
      token: containerTokens.mfaTotpService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.totpService,
        containerTokens.mfaTotpRepository,
      ],
      resolve: ({ resolve }) =>
        new MfaTotpService({
          totpService: resolve(containerTokens.totpService),
          mfaTotpRepository: resolve(containerTokens.mfaTotpRepository),
          encryptionKey,
        }),
    });
    container.register({
      token: containerTokens.mfaTotpController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.mfaTotpService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new MfaTotpController(
          resolve(containerTokens.mfaTotpService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
