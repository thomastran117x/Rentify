import type { Context } from "hono";
import BadRequestError from "@/errors/http/bad-request.error";
import type { AppBindings } from "@/configuration/http/bindings";
import { created, ok } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  createBlobUploadUrlRequestSchema,
  deleteBlobRequestQuerySchema,
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
      requestOrigin: new URL(context.req.url).origin,
    };
  }

  uploadLocal = async (context: Context<AppBindings>): Promise<Response> => {
    const blobName = context.req.query("blobName")?.trim();
    const expiresAt = context.req.query("expiresAt")?.trim();
    const token = context.req.query("token")?.trim();
    const contentType = context.req.header("content-type")?.trim();

    if (!blobName || !expiresAt || !token || !contentType) {
      throw new BadRequestError(
        "Local blob upload query parameters are missing.",
      );
    }

    const body = Buffer.from(await context.req.raw.arrayBuffer());

    await this.blobService.uploadLocalBlob({
      blobName,
      expiresAt,
      token,
      contentType,
      body,
    });

    return new Response(null, {
      status: 201,
    });
  };

  getLocal = async (context: Context<AppBindings>): Promise<Response> => {
    const blobName = context.req.query("blobName")?.trim();

    if (!blobName) {
      throw new BadRequestError("Blob name is required.");
    }

    const blob = await this.blobService.readLocalBlob(blobName);

    return new Response(new Uint8Array(blob.body), {
      status: 200,
      headers: {
        "content-type": blob.contentType,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  };

  delete = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const query = deleteBlobRequestQuerySchema.parse(context.req.query());

    await this.blobService.deleteBlobForUser(auth.sub, query.blobName);

    return ok(
      context,
      {
        deleted: true,
      },
      {
        message: "Blob deleted successfully.",
      },
    );
  };
}
