import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import { PaymentsController } from "@/features/payments/payments.controller";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { PaymentsService } from "@/features/payments/payments.service";
import { SquarePaymentAdapter } from "@/features/payments/square.adapter";

export const paymentsRegistrationModule: ContainerRegistrationModule = {
  id: "payments",
  register(container) {
    container.register({
      token: containerTokens.paymentsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new PaymentsRepository(),
    });
    container.register({
      token: containerTokens.paymentProvider,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new SquarePaymentAdapter() as PaymentProviderAdapter,
    });
    container.register({
      token: containerTokens.paymentsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.paymentsRepository,
        containerTokens.paymentProvider,
        containerTokens.postingsAnalyticsRepository,
        containerTokens.postingsRepository,
        containerTokens.cacheService,
        containerTokens.postingsPublicCacheService,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new PaymentsService(
          resolve(containerTokens.paymentsRepository),
          resolve(containerTokens.paymentProvider),
          resolve(containerTokens.postingsAnalyticsRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.postingsPublicCacheService),
          resolve(containerTokens.organizationAccessService),
        ),
    });
    container.register({
      token: containerTokens.paymentsController,
      lifetime: "scoped",
      dependencies: [containerTokens.paymentsService],
      resolve: ({ resolve }) =>
        new PaymentsController(resolve(containerTokens.paymentsService)),
    });
  },
};
