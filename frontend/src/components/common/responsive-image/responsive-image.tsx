"use client";

import { useState, type ImgHTMLAttributes } from "react";
import type { ImageVariants } from "@/lib/media/api";

/**
 * The longest edge each rendition is fitted inside. The backend never enlarges
 * an image, so a small or portrait image is narrower than this; the browser
 * then picks a slightly larger rendition than it needs, never a blurrier one.
 */
const RENDITION_WIDTHS: Record<keyof ImageVariants, number> = {
  thumbnail: 300,
  medium: 800,
  large: 2560,
};

/** The `srcset` for an image's renditions, smallest first. */
export function buildImageSrcSet(variants: ImageVariants): string {
  return (["thumbnail", "medium", "large"] as const)
    .map(
      (rendition) => `${variants[rendition]} ${RENDITION_WIDTHS[rendition]}w`,
    )
    .join(", ");
}

export type ResponsiveImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "sizes" | "alt"
> & {
  /** The image's own URL: shown as is when it has no renditions. */
  src: string;
  /** Its renditions, when the API reports them. */
  variants?: ImageVariants | null;
  /**
   * How wide the image is drawn, as for the `sizes` attribute, so the browser
   * downloads the smallest rendition that fills it: "40px" for an avatar,
   * "(min-width: 768px) 240px, 100vw" for a card.
   */
  sizes: string;
  alt: string;
};

/**
 * An image that lets the browser choose among its renditions, so a list or an
 * avatar does not download the full processed image.
 *
 * Without renditions (a seeded photo, an image stored before media processing,
 * or a local preview) it renders `src` alone. If a rendition fails to load,
 * as it can for an image processed before renditions existed and not yet
 * backfilled, it falls back to `src` rather than showing a broken image.
 */
export function ResponsiveImage({
  src,
  variants,
  sizes,
  alt,
  onError,
  ...imageProps
}: ResponsiveImageProps) {
  const srcSet = variants ? buildImageSrcSet(variants) : undefined;
  // Keyed on the srcset, so new renditions are tried again after a failure.
  const [failedSrcSet, setFailedSrcSet] = useState<string | null>(null);
  const useRenditions = srcSet !== undefined && srcSet !== failedSrcSet;

  return (
    // The renditions are already sized by the backend; next/image would only
    // re-encode them through a loader this deployment does not configure.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...imageProps}
      alt={alt}
      src={src}
      srcSet={useRenditions ? srcSet : undefined}
      sizes={useRenditions ? sizes : undefined}
      onError={(event) => {
        if (useRenditions) {
          setFailedSrcSet(srcSet);
          return;
        }

        onError?.(event);
      }}
    />
  );
}
