import type { Request, Response } from "express";
import { environment } from "@/configuration/environment";
import { accepted, created, ok } from "@/configuration/http/responses";
import { getRequestUrl, writeCookie } from "@/configuration/http/request";
import {
  requireJwtAuth,
  requireSessionAuth,
} from "@/configuration/middlewares/jwt-middleware";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  CLIENT_UPLOAD_TIMING_HEADER,
  parseClientUploadTiming,
} from "@/features/media/client-upload-timing";
import {
  createMediaUploadRequestSchema,
  MEDIA_STATUS_SOCKET_COOKIE_NAME,
  MEDIA_STATUS_SOCKET_PATH,
} from "@/features/media/media.model";
import type { MediaService } from "@/features/media/media.service";
import type { MediaStatusSocketService } from "@/features/media/media-status-socket.service";

export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly mediaStatusSockets: MediaStatusSocketService,
  ) {}

  createUpload = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const input = await parseRequestBody(
      request,
      createMediaUploadRequestSchema,
    );
    const result = await this.mediaService.createMediaUpload({
      userId: auth.sub,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      scope: input.scope,
      requestOrigin: getRequestUrl(request).origin,
    });

    created(response, result, {
      message: "Media upload created successfully.",
    });
  };

  complete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const media = await this.mediaService.completeMediaUpload(
      auth.sub,
      requireUuidRouteParam(request, "id"),
    );

    accepted(
      response,
      { media },
      {
        message: "Media upload received and queued for processing.",
      },
    );
  };

  get = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const media = await this.mediaService.getMediaView(
      auth.sub,
      requireUuidRouteParam(request, "id"),
      parseClientUploadTiming(request.get(CLIENT_UPLOAD_TIMING_HEADER)),
    );

    ok(response, { media });
  };

  socketTicket = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    // Session bearer only, like the socket it opens: a PAT must not be
    // exchangeable for a long-lived connection.
    const auth = await requireSessionAuth(request);
    const result = await this.mediaStatusSockets.createSocketTicket(auth.sub, {
      // Recorded so the socket can be re-checked against this session later.
      sessionId: typeof auth.sessionId === "string" ? auth.sessionId : null,
      tokenVersion:
        typeof auth.tokenVersion === "number" ? auth.tokenVersion : null,
    });

    // In an HttpOnly cookie scoped to the socket path, not the body or a query
    // parameter: the handshake cannot carry headers, and a query string ends
    // up in proxy and access logs.
    writeCookie(response, MEDIA_STATUS_SOCKET_COOKIE_NAME, result.ticket, {
      path: MEDIA_STATUS_SOCKET_PATH,
      httpOnly: true,
      secure: environment.isProduction(),
      sameSite: "Lax",
      maxAge: result.expiresInSeconds,
    });

    created(
      response,
      { expiresInSeconds: result.expiresInSeconds },
      { message: "Socket ticket issued successfully." },
    );
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);

    await this.mediaService.deleteMediaById(
      auth.sub,
      requireUuidRouteParam(request, "id"),
    );

    ok(
      response,
      { deleted: true },
      {
        message: "Media deleted successfully.",
      },
    );
  };
}
