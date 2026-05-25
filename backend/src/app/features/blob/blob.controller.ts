import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { created } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  createBlobUploadUrlRequestSchema,
  type CreateBlobUploadUrlRequestBody,
  type CreateBlobUploadUrlInput,
} from "@/features/blob/blob.model";
import { BlobService } from "@/features/blob/blob.service";

export class BlobController {
  constructor(private readonly blobService: BlobService) {}

  createUploadUrl = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    await requireJwtAuth(context);
    const input = await parseRequestBody(
      context,
      createBlobUploadUrlRequestSchema,
    );
    const result = this.blobService.createUploadUrl(
      this.toCreateBlobUploadUrlInput(context, input),
    );

    return created(context, result, {
      message: "Blob upload URL created successfully.",
    });
  };

  private toCreateBlobUploadUrlInput(
    context: Context<AppBindings>,
    input: CreateBlobUploadUrlRequestBody,
  ): CreateBlobUploadUrlInput {
    return {
      userId: context.get("auth").sub,
      filename: input.filename,
      contentType: input.contentType,
      scope: input.scope,
    };
  }
}
