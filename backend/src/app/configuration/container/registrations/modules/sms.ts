import { environment } from "@/configuration/environment";
import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { NoopSmsAdapter } from "@/features/sms/noop.adapter";
import type { SmsProviderAdapter } from "@/features/sms/sms-provider";
import { SmsController } from "@/features/sms/sms.controller";
import { SmsDeliveryService } from "@/features/sms/sms.delivery.service";
import { SmsQueueService } from "@/features/sms/sms.queue.service";
import { SmsService } from "@/features/sms/sms.service";
import { TelnyxSmsAdapter } from "@/features/sms/telnyx.adapter";

export const smsRegistrationModule: ContainerRegistrationModule = {
  id: "sms",
  register(container) {
    container.register({
      token: containerTokens.smsQueueService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new SmsQueueService(),
    });
    container.register({
      token: containerTokens.smsProvider,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => {
        const provider = environment.getSmsConfig().provider;
        return (provider === "telnyx"
          ? new TelnyxSmsAdapter()
          : new NoopSmsAdapter()) as SmsProviderAdapter;
      },
    });
    container.register({
      token: containerTokens.smsDeliveryService,
      lifetime: "singleton",
      dependencies: [containerTokens.smsProvider],
      resolve: ({ resolve }) =>
        new SmsDeliveryService(resolve(containerTokens.smsProvider)),
    });
    container.register({
      token: containerTokens.smsService,
      lifetime: "scoped",
      dependencies: [containerTokens.smsQueueService, containerTokens.smsProvider],
      resolve: ({ resolve }) =>
        new SmsService(
          resolve(containerTokens.smsQueueService),
          resolve(containerTokens.smsProvider),
        ),
    });
    container.register({
      token: containerTokens.smsController,
      lifetime: "scoped",
      dependencies: [containerTokens.smsService],
      resolve: ({ resolve }) =>
        new SmsController(resolve(containerTokens.smsService)),
    });
  },
};