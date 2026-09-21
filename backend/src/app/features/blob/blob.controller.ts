import type { Request, Response } from "express";
import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { getQuery } from "@/configuration/http/request";
import type { BlobService } from "@/features/blob/blob.service";
import type { MediaService } from "@/features/media/media.service";

/**
 * The development-only local stand-ins for Azure's upload and public read
 * endpoints. Uploads themselves are started, completed, and deleted through
 * MediaController.
 */
export class BlobController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly blobService: BlobService,
  ) {}

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

    await this.mediaService.receiveLocalUploadBytes({
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

    // Quarantined uploads are unvalidated bytes and are never served, so to a
    // reader they do not exist.
    if (this.blobService.isQuarantineBlobName(blobName)) {
      throw new ResourceNotFoundError("Blob not found.");
    }

    // The local stand-in for Azure's public blob endpoint, which serves stored
    // bytes without involving the backend, so this is a plain storage read.
    const blob = await this.blobService.readLocalBlob(blobName);

    response.status(200);
    response.setHeader("content-type", blob.contentType);
    response.setHeader("cache-control", "public, max-age=31536000, immutable");
    response.end(Buffer.from(blob.body));
  };
}
