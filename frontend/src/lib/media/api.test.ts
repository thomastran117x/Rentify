import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaApi, uploadImage, type MediaView } from "./api";

const { authenticatedJsonMock, readSessionMock, baseUrlMock } = vi.hoisted(
  () => ({
    authenticatedJsonMock: vi.fn(),
    readSessionMock: vi.fn(),
    baseUrlMock: vi.fn(() => "https://api.example.test/api/v1"),
  }),
);

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
}));
vi.mock("@/lib/auth/storage", () => ({ readStoredSession: readSessionMock }));
vi.mock("@/lib/env", () => ({ resolveApiBaseUrl: baseUrlMock }));

const MEDIA_ID = "8b0f3c1e-6a4d-4c8e-9f21-5d7b2a9e4c10";

function mediaView(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: MEDIA_ID,
    status: "pending_upload",
    scope: "postings",
    url: null,
    contentType: "image/png",
    sizeBytes: null,
    width: null,
    height: null,
    variants: null,
    rejectionReason: null,
    createdAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

const UPLOAD = {
  method: "PUT" as const,
  url: "https://storage.test/quarantine/images/u/m?sig=1",
  expiresAt: "2026-09-19T12:15:00.000Z",
  headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "image/png" },
};

/**
 * Routes authenticatedJson by method and path: the create call returns the
 * upload, completion returns the first view, and each status read returns the
 * next view in `reads`.
 */
function routeMediaApi(completed: MediaView, reads: MediaView[] = []) {
  authenticatedJsonMock.mockImplementation(
    async (method: string, path: string) => {
      if (method === "POST" && path === "/media/uploads") {
        return { mediaId: MEDIA_ID, upload: UPLOAD };
      }
      if (method === "POST" && path.endsWith("/complete")) {
        return { media: completed };
      }
      if (method === "GET") {
        return { media: reads.shift() ?? completed };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  );
}

describe("mediaApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the media endpoints", async () => {
    authenticatedJsonMock.mockResolvedValue({ media: mediaView() });

    await mediaApi.createUpload({
      filename: "a.png",
      contentType: "image/png",
      scope: "postings",
    });
    await expect(mediaApi.complete(MEDIA_ID)).resolves.toMatchObject({
      id: MEDIA_ID,
    });
    await expect(mediaApi.get(MEDIA_ID)).resolves.toMatchObject({
      id: MEDIA_ID,
    });
    await mediaApi.delete(MEDIA_ID);

    expect(authenticatedJsonMock.mock.calls).toEqual([
      [
        "POST",
        "/media/uploads",
        { filename: "a.png", contentType: "image/png", scope: "postings" },
      ],
      ["POST", `/media/${MEDIA_ID}/complete`],
      ["GET", `/media/${MEDIA_ID}`],
      ["DELETE", `/media/${MEDIA_ID}`],
    ]);
  });

  it("only sends keepalive deletes when a browser session has an access token", () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response());
    readSessionMock.mockReturnValue(null);
    mediaApi.deleteKeepalive(MEDIA_ID);
    expect(fetchMock).not.toHaveBeenCalled();

    readSessionMock.mockReturnValue({ accessToken: "token" });
    mediaApi.deleteKeepalive(MEDIA_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/media/${MEDIA_ID}`,
      expect.objectContaining({ method: "DELETE", keepalive: true }),
    );
  });
});

describe("uploadImage", () => {
  const sleep = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 201 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads, completes, and waits until the image is ready", async () => {
    const ready = mediaView({
      status: "ready",
      url: `https://cdn.test/media/images/u/${MEDIA_ID}.webp`,
      variants: {
        thumbnail: `https://cdn.test/media/images/u/${MEDIA_ID}.thumbnail.webp`,
        medium: `https://cdn.test/media/images/u/${MEDIA_ID}.medium.webp`,
        large: `https://cdn.test/media/images/u/${MEDIA_ID}.webp`,
      },
    });
    routeMediaApi(mediaView({ status: "uploaded" }), [
      mediaView({ status: "processing" }),
      ready,
    ]);
    const stages: string[] = [];

    const image = await uploadImage(
      new File(["png"], "photo.png", { type: "image/png" }),
      {
        scope: "postings",
        sleep,
        pollDelaysMs: [10, 20],
        onStageChange: (stage) => stages.push(stage),
      },
    );

    // The renditions come along, so a preview can be drawn from them.
    expect(image).toEqual({
      mediaId: MEDIA_ID,
      url: ready.url,
      variants: ready.variants,
    });
    expect(stages).toEqual(["uploading", "processing"]);
    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "POST",
      "/media/uploads",
      {
        filename: "photo.png",
        contentType: "image/png",
        sizeBytes: 3,
        scope: "postings",
      },
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(UPLOAD.url, {
      method: "PUT",
      headers: UPLOAD.headers,
      body: expect.any(File),
    });
    // Completion and polling address the media id the create call returned.
    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "POST",
      `/media/${MEDIA_ID}/complete`,
    );
    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      `/media/${MEDIA_ID}`,
    );
    // Backs off through the configured delays, repeating the last.
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("resolves the content type from the extension when the browser gives none", async () => {
    routeMediaApi(mediaView({ status: "ready", url: "https://cdn.test/a" }));

    await uploadImage(new File(["x"], "scan.jpeg"), { scope: "postings" });

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "POST",
      "/media/uploads",
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
  });

  it("throws the server's reason for a rejected image", async () => {
    routeMediaApi(mediaView({ status: "uploaded" }), [
      mediaView({
        status: "rejected",
        rejectionReason: "Uploaded file could not be read as an image.",
      }),
    ]);

    await expect(
      uploadImage(new File(["x"], "fake.png", { type: "image/png" }), {
        scope: "postings",
        sleep,
      }),
    ).rejects.toThrow("Uploaded file could not be read as an image.");
  });

  it("falls back to a generic message for a rejection without a reason", async () => {
    routeMediaApi(mediaView({ status: "rejected" }));

    await expect(
      uploadImage(new File(["x"], "fake.png", { type: "image/png" }), {
        scope: "postings",
      }),
    ).rejects.toThrow("The image could not be processed.");
  });

  it("stops when the upload itself fails", async () => {
    routeMediaApi(mediaView({ status: "uploaded" }));
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 403 }),
    );

    await expect(
      uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
      }),
    ).rejects.toThrow("Upload failed with status 403.");
    expect(authenticatedJsonMock).toHaveBeenCalledTimes(1);
  });

  it("gives up when processing outlasts the timeout", async () => {
    routeMediaApi(mediaView({ status: "processing" }));
    let clock = 0;

    await expect(
      uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        timeoutMs: 1000,
        sleep: async (ms) => {
          clock += ms;
        },
        pollDelaysMs: [400],
        now: () => clock,
      }),
    ).rejects.toThrow("The image is taking too long to process.");
  });
});
