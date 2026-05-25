import { createMiddleware } from "hono/factory";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";

export const requestLoggerMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const loggerFactory = getRequestContainer(context).resolve(
      containerTokens.loggerFactory,
    );
    const client = context.get("client");
    const requestLogger = loggerFactory
      .forComponent("http-request", "request")
      .child({
        requestId: context.get("requestId"),
        fields: {
          clientIp: client?.ip,
          deviceId: client?.device.id,
          devicePlatform: client?.device.platform,
          deviceType: client?.device.type,
          isMobile: client?.device.isMobile,
        },
      });

    context.set("logger", requestLogger);
    await next();
  },
);
