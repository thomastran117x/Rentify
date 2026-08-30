import type { Request, Response } from "express";
import BadRequestError from "@/errors/http/bad-request.error";
import { created, ok } from "@/configuration/http/responses";
import { getQuery, getRequestUrl } from "@/configuration/http/request";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  createBlobUploadUrlRequestSchema,
  deleteBlobRequestQuerySchema,
  type CreateBlobUploadUrlRequestBody,
  type CreateBlobUploadUrlInput,
} from "@/features/blob/blob.model";
import { BlobService } from "@/features/blob/blob.service";
import { asUuid } from "@/configuration/validation/uuid";

export class BlobController {
  constructor(private readonly blobService: BlobService) {}

  createUploadUrl = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await requireJwtAuth(request);
    const input = await parseRequestBody(
      request,
      createBlobUploadUrlRequestSchema,
    );
    const result = this.blobService.createUploadUrl(
      this.toCreateBlobUploadUrlInput(request, input),
    );

    created(response, result, {
      message: "Blob upload URL created successfully.",
    });
  };

  private toCreateBlobUploadUrlInput(
    request: Request,
    input: CreateBlobUploadUrlRequestBody,
  ): CreateBlobUploadUrlInput {
    return {
      userId: asUuid(request.auth.sub),
      filename: input.filename,
      contentType: input.contentType,
      scope: input.scope,
      requestOrigin: getRequestUrl(request).origin,
    };
  }

  uploadLocal = async (request: Request, response: Response): Promise<void> => {
    const query = getQuery(request);
    const blobName = query.blobName?.trim();
    const expiresAt = query.expiresAt?.trim();
    const token = query.token?.trim();
    const contentType = request.get("content-type")?.trim();

    if (!blobName || !expiresAt || !token || !contentType) {
      throw new BadRequestError(
        "Local blob upload query parameters are missing.",
      );
    }

    // express.raw is mounted on this route, so the body is already a Buffer.
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

    await this.blobService.uploadLocalBlob({
      blobName,
      expiresAt,
      token,
      contentType,
      body,
    });

    response.status(201).end();
  };

  getLocal = async (request: Request, response: Response): Promise<void> => {
    const blobName = getQuery(request).blobName?.trim();

    if (!blobName) {
      throw new BadRequestError("Blob name is required.");
    }

    const blob = await this.blobService.readLocalBlob(blobName);

    response.status(200);
    response.setHeader("content-type", blob.contentType);
    response.setHeader("cache-control", "public, max-age=31536000, immutable");
    response.end(Buffer.from(blob.body));
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const query = deleteBlobRequestQuerySchema.parse(getQuery(request));

    await this.blobService.deleteBlobForUser(auth.sub, query.blobName);

    ok(
      response,
      {
        deleted: true,
      },
      {
        message: "Blob deleted successfully.",
      },
    );
  };
}
