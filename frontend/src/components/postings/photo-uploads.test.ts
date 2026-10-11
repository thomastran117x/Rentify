import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DISCARDED_PHOTO_REASON,
  PhotoUploads,
  describeUploadFailure,
  photoUploadsReducer,
  resolveUploadConcurrency,
  usePhotoUploads,
  type PhotoItem,
  type PhotoUploadDependencies,
} from "./photo-uploads";
import {
  MediaRejectedError,
  type UploadedImage,
  type UploadImageOptions,
} from "@/lib/media/api";
import { ApiClientError, ApiNetworkError } from "@/lib/api/types";

const request = {
  method: "POST" as const,
  path: "/media/uploads",
  requestUrl: "http://localhost:8040/api/v1/media/uploads",
};

function image(mediaId: string): UploadedImage {
  return {
    mediaId,
    url: `https://cdn.test/${mediaId}.webp`,
    variants: null,
  };
}

function file(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

/**
 * An upload whose steps the test drives by hand: `create` reports the media
 * id, then `resolve` or `reject` settles it. Aborting rejects it, as the
 * real uploadImage does.
 */
interface ControlledUpload {
  file: File;
  options: UploadImageOptions;
  create: (mediaId: string) => void;
  resolve: (mediaId: string) => void;
  reject: (error: unknown) => void;
}

function createHarness(overrides: Partial<PhotoUploadDependencies> = {}) {
  const uploads: ControlledUpload[] = [];
  const deps = {
    upload: vi.fn(
      (target: File, options: UploadImageOptions) =>
        new Promise<UploadedImage>((resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
          uploads.push({
            file: target,
            options,
            create: (mediaId) => options.onCreated?.(mediaId),
            resolve: (mediaId) => resolve(image(mediaId)),
            reject,
          });
        }),
    ),
    deleteMedia: vi.fn(async () => undefined),
    deleteMediaKeepalive: vi.fn(),
    concurrency: vi.fn(() => 3),
    createObjectURL: vi.fn((target: File) => `blob:${target.name}`),
    revokeObjectURL: vi.fn(),
    ...overrides,
  };
  const controller = new PhotoUploads(deps);
  return { controller, deps, uploads };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function statuses(controller: PhotoUploads) {
  return controller.getItems().map((item) => item.status);
}

describe("photoUploadsReducer", () => {
  const queued: PhotoItem = {
    key: "photo-1",
    status: "queued",
    file: file("a.jpg"),
    previewUrl: "blob:a",
  };

  it("moves a photo through upload and processing to ready", () => {
    let items = photoUploadsReducer([], { type: "added", items: [queued] });
    items = photoUploadsReducer(items, {
      type: "stageChanged",
      key: "photo-1",
      stage: "uploading",
    });
    expect(items[0].status).toBe("uploading");
    items = photoUploadsReducer(items, {
      type: "stageChanged",
      key: "photo-1",
      stage: "processing",
    });
    expect(items[0].status).toBe("processing");

    items = photoUploadsReducer(items, {
      type: "uploaded",
      key: "photo-1",
      image: {
        mediaId: "media-1",
        url: "https://cdn.test/media-1.webp",
        variants: {
          thumbnail: { url: "https://cdn.test/t.webp", width: 300, height: 1 },
          medium: { url: "https://cdn.test/m.webp", width: 800, height: 1 },
          large: {
            url: "https://cdn.test/media-1.webp",
            width: 900,
            height: 1,
          },
        },
      },
    });

    // The local file is dropped; the preview is the processed thumbnail.
    expect(items[0]).toEqual({
      key: "photo-1",
      status: "ready",
      mediaId: "media-1",
      previewUrl: "https://cdn.test/t.webp",
      previewVariants: expect.objectContaining({ medium: expect.any(Object) }),
    });
  });

  it("keeps the file of a failed photo so it can be retried", () => {
    let items = photoUploadsReducer([queued], {
      type: "failed",
      key: "photo-1",
      reason: "Offline",
      retryable: true,
    });
    expect(items[0]).toMatchObject({
      status: "rejected",
      reason: "Offline",
      retryable: true,
      file: queued.status === "queued" ? queued.file : undefined,
    });

    items = photoUploadsReducer(items, { type: "retried", key: "photo-1" });
    expect(items[0].status).toBe("queued");
  });

  it("does not retry a photo the server refused", () => {
    const items = photoUploadsReducer(
      photoUploadsReducer([queued], {
        type: "failed",
        key: "photo-1",
        reason: "Not an image",
        retryable: false,
      }),
      { type: "retried", key: "photo-1" },
    );
    expect(items[0].status).toBe("rejected");
  });

  it("ignores late events for removed or settled photos", () => {
    const removed = photoUploadsReducer([queued], {
      type: "removed",
      key: "photo-1",
    });
    expect(
      photoUploadsReducer(removed, {
        type: "uploaded",
        key: "photo-1",
        image: image("media-1"),
      }),
    ).toEqual([]);

    const ready = photoUploadsReducer([queued], {
      type: "uploaded",
      key: "photo-1",
      image: image("media-1"),
    });
    expect(
      photoUploadsReducer(ready, {
        type: "failed",
        key: "photo-1",
        reason: "late",
        retryable: true,
      }),
    ).toEqual(ready);
    expect(
      photoUploadsReducer(ready, {
        type: "stageChanged",
        key: "photo-1",
        stage: "processing",
      }),
    ).toEqual(ready);
  });

  it("marks discarded photos rejected, retryable only while the file is held", () => {
    const ready = photoUploadsReducer([queued], {
      type: "uploaded",
      key: "photo-1",
      image: image("media-1"),
    });
    const pending: PhotoItem = { ...queued, key: "photo-2" };
    const stored: PhotoItem = {
      key: "existing",
      status: "stored",
      blobUrl: "https://cdn.test/e.webp",
      blobName: "e.webp",
      previewUrl: "https://cdn.test/e.webp",
    };

    const items = photoUploadsReducer([...ready, pending, stored], {
      type: "discarded",
      keys: ["photo-1", "photo-2", "existing"],
    });

    expect(items[0]).toMatchObject({
      status: "rejected",
      reason: DISCARDED_PHOTO_REASON,
      retryable: false,
    });
    expect(items[1]).toMatchObject({ status: "rejected", retryable: true });
    expect(items[2]).toBe(stored);
  });

  it("replaces every photo on reset", () => {
    expect(photoUploadsReducer([queued], { type: "reset", items: [] })).toEqual(
      [],
    );
  });
});

describe("resolveUploadConcurrency", () => {
  it("uploads fewer photos at once on slow connections", () => {
    expect(resolveUploadConcurrency(undefined)).toBe(3);
    expect(resolveUploadConcurrency({ effectiveType: "4g" })).toBe(3);
    expect(resolveUploadConcurrency({ effectiveType: "3g" })).toBe(2);
    expect(resolveUploadConcurrency({ effectiveType: "2g" })).toBe(1);
    expect(resolveUploadConcurrency({ effectiveType: "slow-2g" })).toBe(1);
    expect(
      resolveUploadConcurrency({ effectiveType: "4g", saveData: true }),
    ).toBe(1);
  });
});

describe("describeUploadFailure", () => {
  it("treats a refused file as final", () => {
    expect(
      describeUploadFailure(
        new MediaRejectedError("Not an image.", "media-1", "corrupt"),
      ),
    ).toEqual({ reason: "Not an image.", retryable: false });
    expect(
      describeUploadFailure(
        new ApiClientError("Image is too large.", {
          code: "FILE_TOO_LARGE",
          status: 413,
          request,
        }),
      ),
    ).toEqual({ reason: "Image is too large.", retryable: false });
  });

  it("lets a failure that was not the file's fault be retried", () => {
    expect(
      describeUploadFailure(
        new MediaRejectedError("Try again.", "media-1", "processing_failed"),
      ).retryable,
    ).toBe(true);
    expect(
      describeUploadFailure(
        new ApiNetworkError("Unable to reach the server.", {
          code: "NETWORK_ERROR",
          request,
        }),
      ),
    ).toEqual({
      reason: expect.stringContaining("Check your connection"),
      retryable: true,
    });
    expect(
      describeUploadFailure(new Error("The image is taking too long.")),
    ).toEqual({ reason: "The image is taking too long.", retryable: true });
    expect(
      describeUploadFailure(
        new ApiClientError("Slow down.", {
          code: "RATE_LIMITED",
          status: 429,
          request,
        }),
      ).retryable,
    ).toBe(true);
  });
});

describe("PhotoUploads", () => {
  it("starts uploading as soon as photos are added, a few at a time", async () => {
    const { controller, deps, uploads } = createHarness();

    controller.add([
      file("1.jpg"),
      file("2.jpg"),
      file("3.jpg"),
      file("4.jpg"),
    ]);

    expect(deps.upload).toHaveBeenCalledTimes(3);
    expect(uploads[0].options).toMatchObject({ scope: "postings" });
    expect(statuses(controller)).toEqual([
      "uploading",
      "uploading",
      "uploading",
      "queued",
    ]);

    uploads[0].create("media-1");
    uploads[0].resolve("media-1");
    await flush();

    // A freed slot starts the next photo.
    expect(deps.upload).toHaveBeenCalledTimes(4);
    expect(uploads[3].file.name).toBe("4.jpg");
    expect(statuses(controller)).toEqual([
      "ready",
      "uploading",
      "uploading",
      "uploading",
    ]);
    expect(deps.revokeObjectURL).toHaveBeenCalledWith("blob:1.jpg");
  });

  it("reads the concurrency limit each time a slot frees", async () => {
    const concurrency = vi.fn(() => 1);
    const { controller, deps, uploads } = createHarness({ concurrency });

    controller.add([file("1.jpg"), file("2.jpg")]);
    expect(deps.upload).toHaveBeenCalledTimes(1);

    uploads[0].resolve("media-1");
    await flush();
    expect(deps.upload).toHaveBeenCalledTimes(2);
  });

  it("reports processing as its own stage", () => {
    const { controller, uploads } = createHarness();
    controller.add([file("1.jpg")]);

    act(() => uploads[0].options.onStageChange?.("processing"));

    expect(statuses(controller)).toEqual(["processing"]);
  });

  it("records a rejection with its reason", async () => {
    const { controller, uploads } = createHarness();
    controller.add([file("1.jpg")]);

    uploads[0].create("media-1");
    uploads[0].reject(
      new MediaRejectedError("Not an image.", "media-1", "corrupt"),
    );
    await flush();

    expect(controller.getItems()[0]).toMatchObject({
      status: "rejected",
      reason: "Not an image.",
      retryable: false,
    });
  });

  it("cancels and deletes an upload removed mid-flight", async () => {
    const { controller, deps, uploads } = createHarness();
    const [added] = controller.add([file("1.jpg")]);
    uploads[0].create("media-1");

    controller.remove(added.key);
    await flush();

    expect(uploads[0].options.signal?.aborted).toBe(true);
    expect(deps.deleteMedia).toHaveBeenCalledWith("media-1");
    expect(deps.revokeObjectURL).toHaveBeenCalledWith("blob:1.jpg");
    expect(controller.getItems()).toEqual([]);
  });

  it("deletes an upload created after it was cancelled", () => {
    const { controller, deps, uploads } = createHarness();
    const [added] = controller.add([file("1.jpg")]);

    controller.remove(added.key);
    expect(deps.deleteMedia).not.toHaveBeenCalled();

    // The create response arrives after the cancellation.
    uploads[0].create("media-1");
    expect(deps.deleteMedia).toHaveBeenCalledWith("media-1");
  });

  it("removes a queued photo without uploading it", async () => {
    const { controller, deps, uploads } = createHarness({
      concurrency: () => 1,
    });
    const [, second] = controller.add([file("1.jpg"), file("2.jpg")]);

    controller.remove(second.key);
    uploads[0].resolve("media-1");
    await flush();

    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(statuses(controller)).toEqual(["ready"]);
  });

  it("retries a photo that failed for a transient reason", async () => {
    const { controller, deps, uploads } = createHarness();
    const [added] = controller.add([file("1.jpg")]);
    uploads[0].create("media-1");
    uploads[0].reject(new Error("The image is taking too long to process."));
    await flush();

    controller.retry(added.key);

    // The first attempt may still finish processing, so it is deleted.
    expect(deps.deleteMedia).toHaveBeenCalledWith("media-1");
    expect(deps.upload).toHaveBeenCalledTimes(2);
    uploads[1].resolve("media-2");
    await flush();
    expect(controller.getItems()[0]).toMatchObject({
      status: "ready",
      mediaId: "media-2",
    });
  });

  it("does not retry a refused file", async () => {
    const { controller, deps, uploads } = createHarness();
    const [added] = controller.add([file("1.jpg")]);
    uploads[0].reject(new MediaRejectedError("No.", "media-1", "corrupt"));
    await flush();

    controller.retry(added.key);

    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("waits for every photo still uploading", async () => {
    const { controller, uploads } = createHarness({ concurrency: () => 1 });
    controller.add([file("1.jpg"), file("2.jpg")]);
    let settled: PhotoItem[] | null = null;

    void controller.waitForUploads().then((items) => {
      settled = items;
    });
    uploads[0].resolve("media-1");
    await flush();
    expect(settled).toBeNull();

    uploads[1].reject(new MediaRejectedError("No.", "media-2", "corrupt"));
    await flush();

    expect(settled).not.toBeNull();
    expect(settled!.map((item) => item.status)).toEqual(["ready", "rejected"]);
  });

  it("stops waiting for a photo removed meanwhile", async () => {
    const { controller } = createHarness();
    const [added] = controller.add([file("1.jpg")]);
    const waiting = controller.waitForUploads();

    controller.remove(added.key);

    await expect(waiting).resolves.toEqual([]);
  });

  it("resolves at once when nothing is uploading", async () => {
    const { controller } = createHarness();
    await expect(controller.waitForUploads()).resolves.toEqual([]);
  });

  it("deletes unsaved uploads on reset, but not saved ones", async () => {
    const { controller, deps, uploads } = createHarness();
    controller.add([file("1.jpg"), file("2.jpg")]);
    uploads[0].create("media-1");
    uploads[0].resolve("media-1");
    uploads[1].create("media-2");
    await flush();

    controller.reset();

    expect(deps.deleteMedia).toHaveBeenCalledWith("media-1");
    expect(deps.deleteMedia).toHaveBeenCalledWith("media-2");
    expect(uploads[1].options.signal?.aborted).toBe(true);
    expect(controller.getItems()).toEqual([]);

    vi.mocked(deps.deleteMedia).mockClear();
    controller.add([file("3.jpg")]);
    uploads[2].create("media-3");
    uploads[2].resolve("media-3");
    await flush();
    controller.markSaved();
    controller.reset();
    expect(deps.deleteMedia).not.toHaveBeenCalled();
  });

  it("ignores a failed delete", async () => {
    const { controller, deps, uploads } = createHarness({
      deleteMedia: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const [added] = controller.add([file("1.jpg")]);
    uploads[0].create("media-1");

    expect(() => controller.remove(added.key)).not.toThrow();
    await flush();
    expect(deps.deleteMedia).toHaveBeenCalled();
  });
});

describe("usePhotoUploads", () => {
  it("renders photo changes and deletes unsaved uploads on unmount", async () => {
    const { deps, uploads } = createHarness();
    const { result, unmount } = renderHook(() => usePhotoUploads(deps));

    act(() => {
      result.current.uploads.add([file("1.jpg")]);
    });
    expect(result.current.items.map((item) => item.status)).toEqual([
      "uploading",
    ]);

    await act(async () => {
      uploads[0].create("media-1");
      uploads[0].resolve("media-1");
      await flush();
    });
    expect(result.current.items[0]).toMatchObject({
      status: "ready",
      mediaId: "media-1",
    });

    unmount();
    expect(deps.deleteMedia).toHaveBeenCalledWith("media-1");
  });

  it("deletes unsaved uploads with keepalive when the page is hidden", async () => {
    const { deps, uploads } = createHarness();
    const { result } = renderHook(() => usePhotoUploads(deps));

    act(() => {
      result.current.uploads.add([file("1.jpg")]);
    });
    await act(async () => {
      uploads[0].create("media-1");
      uploads[0].resolve("media-1");
      await flush();
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(deps.deleteMediaKeepalive).toHaveBeenCalledWith("media-1");

    // Restored from the back/forward cache: the photo is gone server side.
    act(() => {
      const event = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    expect(result.current.items[0]).toMatchObject({
      status: "rejected",
      reason: DISCARDED_PHOTO_REASON,
      retryable: false,
    });
  });
});
