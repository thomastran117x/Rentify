import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { MfaTotpRepository } from "@/features/auth/mfa/totp/mfa-totp.repository";
import { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { TotpService } from "@/features/auth/mfa/totp/totp.service";

function resolveEncryptionKey(): Buffer {
  const raw = process.env.MFA_TOTP_ENCRYPTION_KEY;

  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "MFA_TOTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
    );
  }

  return Buffer.from(raw, "hex");
}

export const authMfaTotpRegistrationModule: ContainerRegistrationModule = {
  id: "auth-mfa-totp",
  register(container) {
    // Validate the encryption key immediately at registration so a
    // misconfigured deploy fails at startup, not on the first MFA API call.
    const encryptionKey = resolveEncryptionKey();

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
  },
};
