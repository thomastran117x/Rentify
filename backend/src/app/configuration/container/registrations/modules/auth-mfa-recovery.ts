import { hkdfSync } from "node:crypto";
import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { environment } from "@/configuration/environment";
import { MfaRecoveryCodeController } from "@/features/auth/mfa/recovery/mfa-recovery-code.controller";
import { MfaRecoveryCodeRepository } from "@/features/auth/mfa/recovery/mfa-recovery-code.repository";
import { MfaRecoveryCodeService } from "@/features/auth/mfa/recovery/mfa-recovery-code.service";

export const authMfaRecoveryRegistrationModule: ContainerRegistrationModule = {
  id: "auth-mfa-recovery",
  register(container) {
    // Derived rather than reused, so hashing never touches the encryption key
    // itself, and no separate secret has to be deployed.
    const hashKey = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(environment.getTokenConfig().mfaTotpEncryptionKey, "hex"),
        Buffer.alloc(0),
        "mfa-recovery-code",
        32,
      ),
    );

    container.register({
      token: containerTokens.mfaRecoveryCodeRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new MfaRecoveryCodeRepository(),
    });
    container.register({
      token: containerTokens.mfaRecoveryCodeService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.mfaRecoveryCodeRepository,
        containerTokens.authAuditService,
        containerTokens.securityNotificationService,
      ],
      resolve: ({ resolve }) =>
        new MfaRecoveryCodeService({
          mfaRecoveryCodeRepository: resolve(
            containerTokens.mfaRecoveryCodeRepository,
          ),
          hashKey,
          authAuditService: resolve(containerTokens.authAuditService),
          securityNotificationService: resolve(
            containerTokens.securityNotificationService,
          ),
        }),
    });
    container.register({
      token: containerTokens.mfaRecoveryCodeController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.mfaRecoveryCodeService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new MfaRecoveryCodeController(
          resolve(containerTokens.mfaRecoveryCodeService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
