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
      clientIp: client?.ip,
      deviceId: client?.device.id,
      devicePlatform: client?.device.platform,
      deviceType: client?.device.type,
      isMobile: client?.device.isMobile,
    },
  });

  next();
};
