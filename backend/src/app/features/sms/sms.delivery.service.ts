import type {
  SmsJobPayload,
  SmsProviderErrorInfo,
  SmsProviderSendResult,
} from "@/features/sms/sms.model";
import type { SmsProviderAdapter } from "@/features/sms/sms-provider";

export class SmsDeliveryService {
  constructor(private readonly smsProvider: SmsProviderAdapter) {}

  async deliver(payload: SmsJobPayload): Promise<SmsProviderSendResult> {
    switch (payload.kind) {
      case "message":
        return this.smsProvider.sendMessage(payload.input);
    }
  }

  classifyError(error: unknown): SmsProviderErrorInfo {
    return this.smsProvider.classifyError(error);
  }
}
