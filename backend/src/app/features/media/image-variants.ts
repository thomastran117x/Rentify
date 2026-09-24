import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";
import type { ImageVariants } from "@/features/media/media.model";

/**
 * The rendition URLs of a stored image reference, for a response next to its
 * URL, or null when the image has no renditions.
 *
 * Only a processed image has them, so seeded `example.com` photos, images
 * stored before media existed, and posting-card crops yield null. The
 * rendition URLs are derived from the stored URL rather than looked up: the
 * rendition name is put where the processed name sits in it, whether that is
 * an Azure blob path or the local `?blobName=` stand-in. A URL that does not
 * address `blobName` there yields null rather than a guess.
 *
 * `large` is the stored URL itself. An image processed before renditions
 * existed is described too, before the backfill has written its smaller
 * renditions; the client falls back to `large` if one fails to load.
 */
export function describeImageVariants(
  blobName: string | null | undefined,
  blobUrl: string | null | undefined,
): ImageVariants | null {
  if (!blobName || !blobUrl) {
    return null;
  }

  const names = buildImageVariantBlobNames(blobName);

  if (!names) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(blobUrl);
  } catch {
    return null;
  }

  const addressOf = locateBlobName(url, names.large);

  if (!addressOf) {
    return null;
  }

  return {
    thumbnail: addressOf(names.thumbnail),
    medium: addressOf(names.medium),
    large: blobUrl,
  };
}

/**
 * Finds where `blobName` sits in `url` and returns how to address another
 * blob in its place, or null when the URL does not address that blob.
 */
function locateBlobName(
  url: URL,
  blobName: string,
): ((name: string) => string) | null {
  // The local development stand-in: /api/v1/blob/file?blobName=<name>
  if (url.searchParams.get("blobName") === blobName) {
    return (name) => {
      const address = new URL(url);
      address.searchParams.set("blobName", name);
      return address.toString();
    };
  }

  // Azure: <account>/<container>/<name>. Processed names only hold characters
  // that need no escaping, so the name appears in the path as it is.
  if (!url.search && url.pathname.endsWith(`/${blobName}`)) {
    const directory = url.pathname.slice(0, -blobName.length);

    return (name) => {
      const address = new URL(url);
      address.pathname = `${directory}${name}`;
      return address.toString();
    };
  }

  return null;
}
