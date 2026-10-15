import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaRejectedError,
  mediaApi,
  uploadImage,
  type MediaView,
} from "./api";

const { authenticatedJsonMock, readSessionMock, baseUrlMock } = vi.hoisted(
  () => ({
    authenticatedJsonMock: vi.fn(),
    readSessionMock: vi.fn(),
    baseUrlMock: vi.fn(() => "https://api.example.test/api/v1"),
  }),
);

/**
 * Stands in for the page's status socket: a test says whether it is listening
 * and pushes statuses itself.
 */
const statusChannel = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<(push: { mediaId: string; status: "ready" | "rejected" }) => void>
  >();
  const channel = {
    listening: false,
    acquired: 0,
    released: 0,
    acquire() {
      channel.acquired += 1;
      return () => {
        channel.released += 1;
      };
    },
    onStatus(
      mediaId: string,
      listener: (push: {
        mediaId: string;
        status: "ready" | "rejected";
      }) => void,
    ) {
      const forMedia = listeners.get(mediaId) ?? new Set();
      forMedia.add(listener);
      listeners.set(mediaId, forMedia);
      return () => {
        forMedia.delete(listener);
      };
    },
    isListening: () => channel.listening,
    push(mediaId: string, status: "ready" | "rejected" = "ready") {
      for (const listener of listeners.get(mediaId) ?? []) {
        listener({ mediaId, status });
      }
    },
    subscribers: () =>
      [...listeners.values()].reduce((count, set) => count + set.size, 0),
    reset() {
      listeners.clear();
      channel.listening = false;
      channel.acquired = 0;
      channel.released = 0;
    },
  };
  return channel;
});

vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedJsonMock,
}));
vi.mock("@/lib/media/status-socket", () => ({
  mediaStatusChannel: statusChannel,
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
    rejectionCode: null,
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
        undefined,
        undefined,
      ],
      ["POST", `/media/${MEDIA_ID}/complete`, undefined, undefined, undefined],
      ["GET", `/media/${MEDIA_ID}`, undefined, undefined, undefined],
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
    statusChannel.reset();
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
        thumbnail: {
          url: `https://cdn.test/media/images/u/${MEDIA_ID}.thumbnail.webp`,
          width: 300,
          height: 225,
        },
        medium: {
          url: `https://cdn.test/media/images/u/${MEDIA_ID}.medium.webp`,
          width: 800,
          height: 600,
        },
        large: {
          url: `https://cdn.test/media/images/u/${MEDIA_ID}.webp`,
          width: 1600,
          height: 1200,
        },
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
      undefined,
      undefined,
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
      undefined,
      undefined,
      undefined,
    );
    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "GET",
      `/media/${MEDIA_ID}`,
      undefined,
      {
        "x-media-upload-timing": expect.stringMatching(
          /^upload=\d+, wait=\d+, via=poll$/,
        ),
      },
      undefined,
    );
    // Backs off through the configured delays, repeating the last.
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("reports how long the upload took and how long it has waited since", async () => {
    let clock = 0;
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      clock += 1_200;
      return new Response(null, { status: 201 });
    });
    authenticatedJsonMock.mockImplementation(
      async (method: string, path: string) => {
        if (method === "POST" && path === "/media/uploads") {
          return { mediaId: MEDIA_ID, upload: UPLOAD };
        }
        if (method === "POST") {
          clock += 100;
          return { media: mediaView({ status: "uploaded" }) };
        }
        return {
          media:
            clock < 1_330
              ? mediaView({ status: "processing" })
              : mediaView({ status: "ready", url: "https://cdn.test/a" }),
        };
      },
    );

    await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
      scope: "postings",
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      pollDelaysMs: [10, 20],
    });

    const timings = authenticatedJsonMock.mock.calls
      .filter(([method]) => method === "GET")
      .map((call) => call[3]?.["x-media-upload-timing"]);
    expect(timings).toEqual([
      "upload=1200, wait=110, via=poll",
      "upload=1200, wait=130, via=poll",
    ]);
  });

  describe("status pushes", () => {
    const READY = mediaView({ status: "ready", url: "https://cdn.test/a" });
    const never = () => new Promise<void>(() => {});
    const timingOf = (call: unknown[]) =>
      (call[3] as Record<string, string> | undefined)?.[
        "x-media-upload-timing"
      ];
    const reads = () =>
      authenticatedJsonMock.mock.calls.filter(([method]) => method === "GET");

    it("reads the item the moment a push says it finished", async () => {
      statusChannel.listening = true;
      routeMediaApi(mediaView({ status: "uploaded" }), [READY]);
      const waits: number[] = [];

      const image = await uploadImage(
        new File(["x"], "a.png", { type: "image/png" }),
        {
          scope: "postings",
          sleep: (ms) => {
            waits.push(ms);
            setTimeout(() => statusChannel.push(MEDIA_ID), 0);
            return never();
          },
        },
      );

      expect(image.url).toBe(READY.url);
      // The fallback check would have waited a second; the push ended it first.
      expect(waits).toEqual([1000]);
      expect(reads()).toHaveLength(1);
      expect(timingOf(reads()[0]!)).toMatch(/via=push$/);
    });

    it("keeps a push that arrives while the upload is being completed", async () => {
      statusChannel.listening = true;
      authenticatedJsonMock.mockImplementation(
        async (method: string, path: string) => {
          if (path === "/media/uploads") {
            return { mediaId: MEDIA_ID, upload: UPLOAD };
          }
          if (method === "POST") {
            statusChannel.push(MEDIA_ID);
            return { media: mediaView({ status: "processing" }) };
          }
          return { media: READY };
        },
      );

      await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        sleep: never,
      });

      expect(timingOf(reads()[0]!)).toMatch(/via=push$/);
    });

    it("polls more slowly while the socket listens, in case a push is lost", async () => {
      statusChannel.listening = true;
      routeMediaApi(mediaView({ status: "uploaded" }), [
        mediaView({ status: "processing" }),
        mediaView({ status: "processing" }),
        mediaView({ status: "processing" }),
        READY,
      ]);

      await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        sleep,
      });

      expect(sleep.mock.calls).toEqual([[1000], [2000], [3000], [3000]]);
      expect(timingOf(reads().at(-1)!)).toMatch(/via=poll$/);
    });

    it("polls at the full rate while the socket does not listen", async () => {
      routeMediaApi(mediaView({ status: "uploaded" }), [READY]);

      await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        sleep,
      });

      expect(sleep.mock.calls).toEqual([[500]]);
    });

    it("ignores a push for another item", async () => {
      statusChannel.listening = true;
      routeMediaApi(mediaView({ status: "uploaded" }), [READY]);

      await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        sleep: async () => {
          statusChannel.push("someone-else");
        },
      });

      expect(timingOf(reads()[0]!)).toMatch(/via=poll$/);
    });

    it("lets go of the socket and the item once it has an answer", async () => {
      routeMediaApi(mediaView({ status: "uploaded" }), [
        mediaView({ status: "rejected", rejectionReason: "No." }),
      ]);

      await expect(
        uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
          scope: "postings",
          sleep,
        }),
      ).rejects.toBeInstanceOf(MediaRejectedError);

      expect(statusChannel.acquired).toBe(1);
      expect(statusChannel.released).toBe(1);
      expect(statusChannel.subscribers()).toBe(0);
    });

    it("lets go of the socket when the upload fails before processing", async () => {
      routeMediaApi(mediaView({ status: "uploaded" }));
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(null, { status: 403 }),
      );

      await expect(
        uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
          scope: "postings",
        }),
      ).rejects.toThrow("Upload failed with status 403.");

      expect(statusChannel.released).toBe(1);
      expect(statusChannel.subscribers()).toBe(0);
    });

    it("takes the socket only once it knows the upload is not already cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
          scope: "postings",
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });

      expect(statusChannel.acquired).toBe(0);
    });
  });

  it("resolves the content type from the extension when the browser gives none", async () => {
    routeMediaApi(mediaView({ status: "ready", url: "https://cdn.test/a" }));

    await uploadImage(new File(["x"], "scan.jpeg"), { scope: "postings" });

    expect(authenticatedJsonMock).toHaveBeenCalledWith(
      "POST",
      "/media/uploads",
      expect.objectContaining({ contentType: "image/jpeg" }),
      undefined,
      undefined,
    );
  });

  it("throws the server's reason for a rejected image", async () => {
    routeMediaApi(mediaView({ status: "uploaded" }), [
      mediaView({
        status: "rejected",
        rejectionReason: "Uploaded file could not be read as an image.",
        rejectionCode: "corrupt",
      }),
    ]);

    const failure = uploadImage(
      new File(["x"], "fake.png", { type: "image/png" }),
      { scope: "postings", sleep },
    );

    await expect(failure).rejects.toThrow(
      "Uploaded file could not be read as an image.",
    );
    // Typed, so a caller can tell a refused file from a dropped connection.
    await expect(failure).rejects.toBeInstanceOf(MediaRejectedError);
    await expect(failure).rejects.toMatchObject({
      mediaId: MEDIA_ID,
      code: "corrupt",
    });
  });

  it("reports the media id as soon as the upload exists", async () => {
    routeMediaApi(mediaView({ status: "ready", url: "https://cdn.test/a" }));
    const order: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      order.push("put");
      return new Response(null, { status: 201 });
    });

    await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
      scope: "postings",
      onCreated: (mediaId) => order.push(`created:${mediaId}`),
    });

    expect(order).toEqual([`created:${MEDIA_ID}`, "put"]);
  });

  it("passes the abort signal to every request", async () => {
    routeMediaApi(mediaView({ status: "uploaded" }), [
      mediaView({ status: "ready", url: "https://cdn.test/a" }),
    ]);
    const controller = new AbortController();

    await uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
      scope: "postings",
      sleep,
      signal: controller.signal,
    });

    for (const call of authenticatedJsonMock.mock.calls) {
      expect(call[4]).toBe(controller.signal);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      UPLOAD.url,
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("makes no request when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(authenticatedJsonMock).not.toHaveBeenCalled();
  });

  it("stops before the transfer when cancelled after the upload exists", async () => {
    routeMediaApi(mediaView({ status: "uploaded" }));
    const controller = new AbortController();

    await expect(
      uploadImage(new File(["x"], "a.png", { type: "image/png" }), {
        scope: "postings",
        signal: controller.signal,
        onCreated: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(authenticatedJsonMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling when cancelled while waiting", async () => {
    vi.useFakeTimers();
    try {
      routeMediaApi(mediaView({ status: "processing" }));
      const controller = new AbortController();
      const failure = uploadImage(
        new File(["x"], "a.png", { type: "image/png" }),
        { scope: "postings", signal: controller.signal, pollDelaysMs: [5000] },
      );
      const settled = expect(failure).rejects.toMatchObject({
        name: "AbortError",
      });

      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      await settled;
      // Create and complete only: the pending poll never fires.
      expect(authenticatedJsonMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
