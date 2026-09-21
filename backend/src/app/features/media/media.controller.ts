import type { Request, Response } from "express";
import { accepted, created, ok } from "@/configuration/http/responses";
import { getRequestUrl } from "@/configuration/http/request";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestBody } from "@/configuration/validation/request";
import { createMediaUploadRequestSchema } from "@/features/media/media.model";
import type { MediaService } from "@/features/media/media.service";

export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

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
    );

    ok(response, { media });
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
