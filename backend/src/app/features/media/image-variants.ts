import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";
import type {
  ImageRendition,
  ImageRenditionInfo,
  ImageVariants,
  ImageVariantsReference,
  RecordedRenditions,
} from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";

const REFERENCE_KEY = "$imageVariants";

/**
 * Marks a stored image reference for ImageVariantsResolver, or returns null
 * when it cannot have renditions.
 *
 * Only a processed image has them, so seeded `example.com` photos, images
 * stored before media existed, and posting-card crops yield null here, and so
 * does a URL that does not address `blobName` (see locateBlobName). Whether
 * the renditions exist, and how large they are, is only known from the media
 * row, which the resolver reads for every reference in a payload at once.
 */
export function referenceImageVariants(
  blobName: string | null | undefined,
  blobUrl: string | null | undefined,
): ImageVariantsReference | null {
  if (!blobName || !blobUrl || !describeAddresses(blobName, blobUrl)) {
    return null;
  }

  return { [REFERENCE_KEY]: { blobName: blobName.trim(), blobUrl } };
}

/**
 * The renditions of a processed image as its media row records them, or null
 * when none are recorded: an image processed before renditions existed and
 * not yet backfilled, or one whose media row is gone. `large` is the stored URL
 * itself; a rendition that was not written, because the image is no wider
 * than it, is the large one.
 */
export function buildImageVariants(
  blobName: string,
  blobUrl: string,
  recorded: RecordedRenditions | null | undefined,
): ImageVariants | null {
  const addressOf = describeAddresses(blobName, blobUrl);

  if (
    !addressOf ||
    !recorded?.variants ||
    recorded.width === null ||
    recorded.height === null
  ) {
    return null;
  }

  const large: ImageRendition = {
    url: blobUrl,
    width: recorded.width,
    height: recorded.height,
  };
  const rendition = (
    name: string,
    info: ImageRenditionInfo | null,
  ): ImageRendition =>
    info
      ? { url: addressOf(name), width: info.width, height: info.height }
      : large;

  return {
    thumbnail: rendition(
      addressOf.names.thumbnail,
      recorded.variants.thumbnail,
    ),
    medium: rendition(addressOf.names.medium, recorded.variants.medium),
    large,
  };
}

export function isImageVariantsReference(
  value: unknown,
): value is ImageVariantsReference {
  return (
    typeof value === "object" &&
    value !== null &&
    REFERENCE_KEY in value &&
    typeof (value as ImageVariantsReference)[REFERENCE_KEY]?.blobName ===
      "string"
  );
}

/** Whether a payload still holds a reference anywhere in it. */
export function containsImageVariantsReference(value: unknown): boolean {
  let found = false;
  visit(value, (reference) => {
    found = true;
    return reference;
  });
  return found;
}

/**
 * Replaces every reference with null. For a payload that must still go out
 * when the lookup failed: the client then shows each image's plain URL.
 */
export function withoutImageVariantsReferences<T>(value: T): T {
  return visit(value, () => null) as T;
}

/**
 * Turns every ImageVariantsReference in a payload into the renditions its
 * media row records, with one lookup for the whole payload. Mappers stay
 * synchronous and emit references; whatever sends the payload out resolves it
 * here first. The payload is not modified: a copy is returned, so a cached
 * object is never rewritten.
 */
export class ImageVariantsResolver {
  constructor(
    private readonly mediaRepository: Pick<
      MediaRepository,
      "findRecordedRenditions"
    >,
  ) {}

  async resolve<T>(value: T): Promise<T> {
    const blobNames = new Set<string>();
    visit(value, (reference) => {
      blobNames.add(reference[REFERENCE_KEY].blobName);
      return reference;
    });

    if (blobNames.size === 0) {
      return value;
    }

    const recorded = await this.mediaRepository.findRecordedRenditions([
      ...blobNames,
    ]);

    return visit(value, (reference) => {
      const { blobName, blobUrl } = reference[REFERENCE_KEY];
      return buildImageVariants(blobName, blobUrl, recorded.get(blobName));
    }) as T;
  }
}

/**
 * Walks plain objects and arrays, replacing each reference with what `replace`
 * returns. Containers are copied only when something inside them changed.
 */
function visit(
  value: unknown,
  replace: (reference: ImageVariantsReference) => unknown,
): unknown {
  if (isImageVariantsReference(value)) {
    return replace(value);
  }

  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = visit(item, replace);
      changed ||= next !== item;
      return next;
    });
    return changed ? items : value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  let copy: Record<string, unknown> | null = null;

  for (const [key, item] of Object.entries(value)) {
    const next = visit(item, replace);

    if (next !== item) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }

  return copy ?? value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type AddressOf = ((name: string) => string) & {
  names: { thumbnail: string; medium: string };
};

/**
 * How to address each rendition of `blobName`, found from where the name sits
 * in its stored URL, or null when the name is not a processed image or the URL
 * does not address it.
 */
function describeAddresses(
  blobName: string,
  blobUrl: string,
): AddressOf | null {
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

  return addressOf
    ? Object.assign(addressOf, {
        names: { thumbnail: names.thumbnail, medium: names.medium },
      })
    : null;
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
