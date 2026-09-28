"use client";

import { useCallback, useState, type ImgHTMLAttributes } from "react";
import type { ImageRendition, ImageVariants } from "@/lib/media/api";

const RENDITIONS = ["thumbnail", "medium", "large"] as const;

function isRendition(value: unknown): value is ImageRendition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const { url, width } = value as Partial<ImageRendition>;

  return (
    typeof url === "string" &&
    url.length > 0 &&
    typeof width === "number" &&
    Number.isInteger(width) &&
    width > 0
  );
}

/**
 * The `srcset` for an image's renditions, smallest first, described by their
 * real widths. A rendition the image was too narrow for is given as the large
 * one, so each URL is offered once.
 *
 * Undefined when there is nothing to choose between: no renditions, a single
 * one, or a value not in the shape the API reports now (such as one cached by
 * an older release), which is treated as none rather than trusted.
 */
export function buildImageSrcSet(
  variants: ImageVariants | null | undefined,
): string | undefined {
  if (!variants || typeof variants !== "object") {
    return undefined;
  }

  const offered = new Map<string, number>();

  for (const name of RENDITIONS) {
    const rendition: unknown = variants[name];

    if (!isRendition(rendition)) {
      return undefined;
    }
    if (!offered.has(rendition.url)) {
      offered.set(rendition.url, rendition.width);
    }
  }

  if (offered.size < 2) {
    return undefined;
  }

  return Array.from(offered, ([url, width]) => `${url} ${width}w`).join(", ");
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
 * Without renditions (a seeded photo, an image stored before media processing
 * or not yet backfilled, or a local preview) it renders `src` alone. The API
 * only reports renditions it has recorded, but if one still fails to load, it
 * falls back to `src` rather than showing a broken image.
 *
 * A server-rendered image can fail before hydration attaches `onError`, and
 * React does not replay that event, so the image is also checked once it is
 * attached: finished loading with no pixels means it already failed.
 */
export function ResponsiveImage({
  src,
  variants,
  sizes,
  alt,
  onError,
  ...imageProps
}: ResponsiveImageProps) {
  const srcSet = buildImageSrcSet(variants);
  // Keyed on the srcset, so new renditions are tried again after a failure.
  const [failedSrcSet, setFailedSrcSet] = useState<string | null>(null);
  const useRenditions = srcSet !== undefined && srcSet !== failedSrcSet;
  const detectEarlyFailure = useCallback(
    (image: HTMLImageElement | null) => {
      if (
        image &&
        srcSet !== undefined &&
        image.getAttribute("srcset") === srcSet &&
        image.complete &&
        image.naturalWidth === 0
      ) {
        setFailedSrcSet(srcSet);
      }
    },
    [srcSet],
  );

  return (
    // The renditions are already sized by the backend; next/image would only
    // re-encode them through a loader this deployment does not configure.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...imageProps}
      ref={detectEarlyFailure}
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
