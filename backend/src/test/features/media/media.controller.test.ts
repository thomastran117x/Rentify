import { RequestValidationError } from "@/configuration/validation/request";
import { MediaController } from "@/features/media/media.controller";
import type { MediaService } from "@/features/media/media.service";
import { invokeHandler } from "../../support/mock-http";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 994280);
const MEDIA_ID = testUuid(9000, 994281);

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

// Input sanitization reads its inspector from the request container.
const requestState = {
  requestId: "request-1",
  container: { resolve: () => ({ inspectRequest: () => [] }) },
};

const mediaView = {
  id: MEDIA_ID,
  status: "pending_upload",
  scope: "postings",
  url: null,
};

function createController() {
  const mediaService = {
    createMediaUpload: jest.fn(async () => ({
      media: mediaView,
      upload: { method: "PUT", uploadUrl: "https://upload.test/x" },
    })),
    completeMediaUpload: jest.fn(async () => ({
      ...mediaView,
      status: "uploaded",
    })),
    getMediaView: jest.fn(async () => mediaView),
    deleteMediaById: jest.fn(async () => undefined),
  };

  return {
    controller: new MediaController(mediaService as unknown as MediaService),
    mediaService,
  };
}

describe("MediaController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue({ sub: USER_ID });
  });

  it("starts an upload for the authenticated user", async () => {
    const { controller, mediaService } = createController();

    const result = await invokeHandler(controller.createUpload, {
      method: "POST",
      url: "https://api.rent.test/api/v1/media/uploads",
      body: {
        filename: "photo.png",
        contentType: "image/png",
        sizeBytes: 12,
        scope: "postings",
      },
      state: requestState,
    });

    expect(result.status).toBe(201);
    expect(mediaService.createMediaUpload).toHaveBeenCalledWith({
      userId: USER_ID,
      filename: "photo.png",
      contentType: "image/png",
      sizeBytes: 12,
      scope: "postings",
      requestOrigin: "https://api.rent.test",
    });
    await expect(result.json()).resolves.toMatchObject({
      data: { media: mediaView },
    });
  });

  it("completes, reads, and deletes by route id", async () => {
    const { controller, mediaService } = createController();
    const options = { params: { id: MEDIA_ID }, state: requestState };

    const completed = await invokeHandler(controller.complete, options);
    const read = await invokeHandler(controller.get, options);
    const deleted = await invokeHandler(controller.delete, options);

    expect(completed.status).toBe(202);
    await expect(completed.json()).resolves.toMatchObject({
      data: { media: { status: "uploaded" } },
    });
    expect(read.status).toBe(200);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      data: { deleted: true },
    });
    for (const method of [
      mediaService.completeMediaUpload,
      mediaService.getMediaView,
      mediaService.deleteMediaById,
    ]) {
      expect(method).toHaveBeenCalledWith(USER_ID, MEDIA_ID);
    }
  });

  it("rejects a malformed media id before reaching the service", async () => {
    const { controller, mediaService } = createController();

    await expect(
      invokeHandler(controller.get, {
        params: { id: "not-a-uuid" },
        state: requestState,
      }),
    ).rejects.toThrow(RequestValidationError);
    expect(mediaService.getMediaView).not.toHaveBeenCalled();
  });
});
