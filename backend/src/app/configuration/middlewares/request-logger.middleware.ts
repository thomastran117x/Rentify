import type { RequestHandler } from "express";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";

export const requestLoggerMiddleware: RequestHandler = (
  request,
  _response,
  next,
) => {
  const loggerFactory = getRequestContainer(request).resolve(
    containerTokens.loggerFactory,
  );
  const client = request.client;

  request.logger = loggerFactory.forComponent("http-request", "request").child({
    requestId: request.requestId,
    fields: {
      clientApp: client?.declaredApp,
      clientIp: client?.ip,
      clientOrigin: client?.origin,
      clientSource: client?.source,
      deviceId: client?.device.id,
      devicePlatform: client?.device.platform,
      deviceType: client?.device.type,
      isMobile: client?.device.isMobile,
    },
  });

  next();
};
