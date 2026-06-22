import { containerTokens } from "@/configuration/bootstrap/container";
import type { SmsController } from "@/features/sms/sms.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const smsRouteModule: RouteModule = {
  id: "sms",
  register(app, { resolveHandler }) {
    app.post(
      "/sms/webhooks/telnyx",
      resolveHandler<SmsController>(containerTokens.smsController, "webhook"),
    );
  },
};
