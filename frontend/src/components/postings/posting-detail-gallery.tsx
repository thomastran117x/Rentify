"use client";

import { useState } from "react";
import type { PublicPostingPhoto } from "@/lib/postings/public";
import { isRenderablePreviewImageUrl } from "@/lib/postings/public-format";
import { theme } from "@/styles/theme";

interface PostingDetailGalleryProps {
  photos: PublicPostingPhoto[];
  name: string;
}

export function PostingDetailGallery({
  photos,
  name,
}: PostingDetailGalleryProps) {
  const renderablePhotos = photos.filter((photo) =>
    isRenderablePreviewImageUrl(photo.thumbnailBlobUrl ?? photo.blobUrl),
  );
  const [selectedPhotoId, setSelectedPhotoId] = useState(
    renderablePhotos[0]?.id ?? null,
  );
  const selectedPhoto =
    renderablePhotos.find((photo) => photo.id === selectedPhotoId) ??
    renderablePhotos[0] ??
    null;

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 shadow-sm">
        <div className="aspect-[4/3]">
          {selectedPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedPhoto.blobUrl}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className={theme.marketplace.resultFallback}>
              Preview Unavailable
            </div>
          )}
        </div>
      </div>

      {renderablePhotos.length > 1 ? (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {renderablePhotos.map((photo, index) => {
            const isSelected = photo.id === selectedPhoto?.id;

            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => setSelectedPhotoId(photo.id)}
                className={`overflow-hidden rounded-2xl border bg-white dark:bg-slate-900 transition duration-200 ${
                  isSelected
                    ? "border-violet-300 ring-4 ring-violet-100"
                    : "border-slate-200 dark:border-slate-800 hover:-translate-y-0.5 hover:border-violet-200 dark:hover:border-violet-800"
                }`}
                aria-label={`View photo ${index + 1} for ${name}`}
                aria-pressed={isSelected}
              >
                <div className="aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.thumbnailBlobUrl ?? photo.blobUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
