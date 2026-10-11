"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiClientError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  MediaRejectedError,
  mediaApi,
  uploadImage,
  type ImageVariants,
  type UploadedImage,
  type UploadImageOptions,
} from "@/lib/media/api";

interface PhotoBase {
  key: string;
  /** A local object URL until the photo is processed, then the stored image. */
  previewUrl: string;
  /** The processed photo's renditions; a local file has none. */
  previewVariants?: ImageVariants | null;
}

/** Waiting for an upload slot, transferring, or being processed. */
export type PendingPhotoStatus = "queued" | "uploading" | "processing";

/**
 * One photo in the posting wizard. A picked file is `queued` until an upload
 * slot frees up, then `uploading` and `processing`, and ends `ready` with the
 * media id a save refers to, or `rejected` with the reason. A photo already
 * on the posting is `stored` and is resent by its blob name.
 */
export type PhotoItem =
  | (PhotoBase & { status: PendingPhotoStatus; file: File })
  | (PhotoBase & { status: "ready"; mediaId: string })
  | (PhotoBase & {
      status: "rejected";
      reason: string;
      /** False when the server refused the file itself: retrying won't help. */
      retryable: boolean;
      /** Kept for a retry; gone when the photo was already processed. */
      file?: File;
    })
  | (PhotoBase & { status: "stored"; blobUrl: string; blobName: string });

export type PhotoUploadAction =
  | { type: "added"; items: PhotoItem[] }
  | { type: "stageChanged"; key: string; stage: "uploading" | "processing" }
  | { type: "uploaded"; key: string; image: UploadedImage }
  | { type: "failed"; key: string; reason: string; retryable: boolean }
  | { type: "removed"; key: string }
  | { type: "retried"; key: string }
  | { type: "reset"; items: PhotoItem[] }
  | { type: "discarded"; keys: string[] };

export const DISCARDED_PHOTO_REASON =
  "This photo was removed when you left the page. Remove it and add it again.";

export function isPhotoPending(
  item: PhotoItem,
): item is Extract<PhotoItem, { status: PendingPhotoStatus }> {
  return (
    item.status === "queued" ||
    item.status === "uploading" ||
    item.status === "processing"
  );
}

function hasLocalPreview(item: PhotoItem): boolean {
  return "file" in item && item.file !== undefined;
}

/**
 * The photo state machine. Events for a photo that was removed meanwhile, or
 * that is no longer in the state they apply to, are ignored, so a late
 * response can never bring a removed photo back.
 */
export function photoUploadsReducer(
  items: PhotoItem[],
  action: PhotoUploadAction,
): PhotoItem[] {
  switch (action.type) {
    case "added":
      return [...items, ...action.items];
    case "reset":
      return action.items;
    case "removed":
      return items.filter((item) => item.key !== action.key);
    case "stageChanged":
      return items.map((item) =>
        item.key === action.key && isPhotoPending(item)
          ? { ...item, status: action.stage }
          : item,
      );
    case "uploaded":
      return items.map((item) =>
        item.key === action.key && isPhotoPending(item)
          ? {
              key: item.key,
              status: "ready",
              mediaId: action.image.mediaId,
              previewUrl:
                action.image.variants?.thumbnail.url ?? action.image.url,
              previewVariants: action.image.variants,
            }
          : item,
      );
    case "failed":
      return items.map((item) =>
        item.key === action.key && isPhotoPending(item)
          ? {
              key: item.key,
              status: "rejected",
              reason: action.reason,
              retryable: action.retryable,
              file: item.file,
              previewUrl: item.previewUrl,
            }
          : item,
      );
    case "retried":
      return items.map((item) =>
        item.key === action.key &&
        item.status === "rejected" &&
        item.retryable &&
        item.file
          ? {
              key: item.key,
              status: "queued",
              file: item.file,
              previewUrl: item.previewUrl,
            }
          : item,
      );
    case "discarded": {
      const keys = new Set(action.keys);
      return items.map((item) =>
        keys.has(item.key) && (isPhotoPending(item) || item.status === "ready")
          ? {
              key: item.key,
              status: "rejected",
              reason: DISCARDED_PHOTO_REASON,
              // A file still held can simply be sent again.
              retryable: "file" in item,
              ...("file" in item ? { file: item.file } : {}),
              previewUrl: item.previewUrl,
              previewVariants: item.previewVariants,
            }
          : item,
      );
    }
  }
}

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

/**
 * How many photos to upload at once. A posting with many photos must not
 * saturate a slow uplink, nor the media worker's prefetch.
 */
export function resolveUploadConcurrency(
  connection?: NetworkInformationLike | null,
): number {
  if (!connection) {
    return 3;
  }

  if (
    connection.saveData ||
    connection.effectiveType === "slow-2g" ||
    connection.effectiveType === "2g"
  ) {
    return 1;
  }

  return connection.effectiveType === "3g" ? 2 : 3;
}

function readConnection(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (
    (navigator as Navigator & { connection?: NetworkInformationLike })
      .connection ?? null
  );
}

/**
 * Describes why a photo did not upload. Only a server verdict on the file
 * itself is final; a dropped connection, a timeout, or a processing failure
 * that was not the image's fault can be retried.
 */
export function describeUploadFailure(error: unknown): {
  reason: string;
  retryable: boolean;
} {
  if (error instanceof MediaRejectedError) {
    return {
      reason: error.message,
      retryable: error.code === "processing_failed",
    };
  }

  const reason = getApiErrorMessage(error, {
    action: "upload this photo",
    fallback: "We couldn't upload this photo. Please try again.",
    preserveClientMessage: true,
    preserveUnknownErrorMessage: true,
  });

  if (
    error instanceof ApiClientError &&
    error.status !== 408 &&
    error.status !== 429
  ) {
    return { reason, retryable: false };
  }

  return { reason, retryable: true };
}

export interface PhotoUploadDependencies {
  upload: (file: File, options: UploadImageOptions) => Promise<UploadedImage>;
  deleteMedia: (mediaId: string) => Promise<void>;
  deleteMediaKeepalive: (mediaId: string) => void;
  concurrency: () => number;
  createObjectURL: (file: File) => string;
  revokeObjectURL: (url: string) => void;
}

const defaultDependencies: PhotoUploadDependencies = {
  upload: uploadImage,
  deleteMedia: (mediaId) => mediaApi.delete(mediaId),
  deleteMediaKeepalive: (mediaId) => mediaApi.deleteKeepalive(mediaId),
  concurrency: () => resolveUploadConcurrency(readConnection()),
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Uploads posting photos as soon as they are picked, a few at a time, and
 * deletes the uploads the posting never saved: when a photo is removed, the
 * wizard is reset or left, or the page is hidden. The unattached-media sweep
 * deletes anything this misses.
 */
export class PhotoUploads {
  private items: PhotoItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly queue: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly pending = new Map<string, Deferred>();
  /** Media ids uploaded for a photo and not yet saved, by photo key. */
  private readonly staged = new Map<string, string>();
  /** Photos whose uploads were deleted when the page was hidden. */
  private flushedKeys: string[] = [];
  private nextKey = 0;
  private readonly deps: PhotoUploadDependencies;

  constructor(deps: Partial<PhotoUploadDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps };
  }

  getItems = (): PhotoItem[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts uploading each file, as soon as a slot is free. */
  add = (files: File[]): PhotoItem[] => {
    const additions: PhotoItem[] = files.map((file) => {
      this.nextKey += 1;
      return {
        key: `photo-${this.nextKey}`,
        status: "queued",
        file,
        previewUrl: this.deps.createObjectURL(file),
      };
    });

    this.commit({ type: "added", items: additions });
    for (const item of additions) {
      this.enqueue(item.key);
    }
    this.pump();
    return additions;
  };

  /** Drops a photo, cancelling its upload and deleting what was uploaded. */
  remove = (key: string): void => {
    const item = this.items.find((candidate) => candidate.key === key);

    if (!item) {
      return;
    }

    this.cancel(key);
    this.discardStaged(key);
    if (hasLocalPreview(item)) {
      this.deps.revokeObjectURL(item.previewUrl);
    }
    this.commit({ type: "removed", key });
  };

  /** Sends a photo that failed for a reason other than the file again. */
  retry = (key: string): void => {
    const item = this.items.find((candidate) => candidate.key === key);

    if (item?.status !== "rejected" || !item.retryable || !item.file) {
      return;
    }

    this.discardStaged(key);
    this.commit({ type: "retried", key });
    this.enqueue(key);
    this.pump();
  };

  /**
   * Replaces every photo, such as when another posting is opened or the
   * wizard is closed. Uploads that were never saved are deleted.
   */
  reset = (items: PhotoItem[] = []): void => {
    this.releaseAll();
    this.commit({ type: "reset", items });
  };

  /** Resolves with the photos once none is waiting, uploading, or processing. */
  waitForUploads = async (): Promise<PhotoItem[]> => {
    while (this.pending.size > 0) {
      await Promise.all(
        [...this.pending.values()].map((deferred) => deferred.promise),
      );
    }
    return this.items;
  };

  /** The posting now references its uploads, so they must not be deleted. */
  markSaved = (): void => {
    this.staged.clear();
  };

  /**
   * Listens for the page being hidden. Returns the cleanup, which also
   * deletes unsaved uploads, as leaving the wizard does.
   */
  connect = (): (() => void) => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const handlePageHide = () => {
      this.flushedKeys = [...this.staged.keys()];
      for (const mediaId of this.staged.values()) {
        this.deps.deleteMediaKeepalive(mediaId);
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      const keys = this.flushedKeys;
      this.flushedKeys = [];

      // Restored from the back/forward cache: the uploads deleted on the way
      // out are gone, so say so rather than fail at save.
      if (!event.persisted || keys.length === 0) {
        return;
      }

      for (const key of keys) {
        this.cancel(key);
        this.staged.delete(key);
      }
      this.commit({ type: "discarded", keys });
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      this.releaseAll();
    };
  };

  private commit(action: PhotoUploadAction): void {
    this.items = photoUploadsReducer(this.items, action);
    for (const listener of this.listeners) {
      listener();
    }
  }

  private enqueue(key: string): void {
    this.pending.set(key, createDeferred());
    this.queue.push(key);
  }

  private settle(key: string): void {
    const deferred = this.pending.get(key);
    this.pending.delete(key);
    deferred?.resolve();
  }

  private cancel(key: string): void {
    const index = this.queue.indexOf(key);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    this.settle(key);
  }

  /** Best effort: the unattached-media sweep is the backstop. */
  private discardStaged(key: string): void {
    const mediaId = this.staged.get(key);

    if (!mediaId) {
      return;
    }

    this.staged.delete(key);
    this.deps.deleteMedia(mediaId).catch(() => undefined);
  }

  private releaseAll(): void {
    for (const key of [...this.queue, ...this.controllers.keys()]) {
      this.cancel(key);
    }
    for (const key of [...this.staged.keys()]) {
      this.discardStaged(key);
    }
    for (const item of this.items) {
      if (hasLocalPreview(item)) {
        this.deps.revokeObjectURL(item.previewUrl);
      }
    }
    for (const key of [...this.pending.keys()]) {
      this.settle(key);
    }
  }

  private pump(): void {
    const limit = this.deps.concurrency();

    while (this.controllers.size < limit && this.queue.length > 0) {
      const key = this.queue.shift()!;
      this.start(key);
    }
  }

  private start(key: string): void {
    const item = this.items.find((candidate) => candidate.key === key);

    if (item?.status !== "queued") {
      this.settle(key);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    this.controllers.set(key, controller);
    this.commit({ type: "stageChanged", key, stage: "uploading" });

    this.deps
      .upload(item.file, {
        scope: "postings",
        signal,
        onStageChange: (stage) => {
          if (!signal.aborted) {
            this.commit({ type: "stageChanged", key, stage });
          }
        },
        onCreated: (mediaId) => {
          if (signal.aborted) {
            // Cancelled while the upload was being created.
            this.deps.deleteMedia(mediaId).catch(() => undefined);
            return;
          }
          this.staged.set(key, mediaId);
        },
      })
      .then((image) => {
        if (signal.aborted) {
          return;
        }
        this.deps.revokeObjectURL(item.previewUrl);
        this.commit({ type: "uploaded", key, image });
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          return;
        }
        if (error instanceof MediaRejectedError) {
          // A rejected item holds no image; the server purges it.
          this.staged.delete(key);
        }
        this.commit({ type: "failed", key, ...describeUploadFailure(error) });
      })
      .finally(() => {
        if (this.controllers.get(key) === controller) {
          this.controllers.delete(key);
        }
        this.settle(key);
        this.pump();
      });
  }
}

/**
 * The posting wizard's photos, uploaded as they are picked. Unsaved uploads
 * are deleted when the component unmounts or the page is hidden.
 */
export function usePhotoUploads(deps?: Partial<PhotoUploadDependencies>) {
  const [uploads] = useState(() => new PhotoUploads(deps));
  const items = useSyncExternalStore(
    uploads.subscribe,
    uploads.getItems,
    uploads.getItems,
  );

  useEffect(() => uploads.connect(), [uploads]);

  return { items, uploads };
}
