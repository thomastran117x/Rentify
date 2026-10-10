import { Prisma } from "@/generated/prisma/client";

/**
 * Every column that stores a reference to an image, and the one place that
 * lists them. Whether an image is attached (the media cleanup and
 * MediaService.deleteMediaById) and which blobs are still in use (the orphaned
 * blob cleanup) are both read from it, so a new image column added here is
 * seen by all of them at once. A column missing from it would have its images
 * deleted while still displayed; image-references.test.ts fails when a
 * `*_blob_name` column in the schema is not listed, or not indexed.
 *
 * `source` names the column's group in the blob cleanup's reference counts.
 */
export const IMAGE_REFERENCE_COLUMNS = [
  { source: "postingPhotos", table: "posting_photos", column: "blob_name" },
  {
    source: "postingPhotos",
    table: "posting_photos",
    column: "thumbnail_blob_name",
  },
  { source: "profiles", table: "profiles", column: "avatar_blob_name" },
  { source: "organizations", table: "organizations", column: "logo_blob_name" },
  {
    source: "blogPosts",
    table: "organization_blog_posts",
    column: "cover_image_blob_name",
  },
] as const;

export type ImageReferenceSource =
  (typeof IMAGE_REFERENCE_COLUMNS)[number]["source"];

type QueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

// The identifiers are the constants above, never input, so splicing them in
// raw is safe; every value is still a bound parameter.
function identifiers(entry: (typeof IMAGE_REFERENCE_COLUMNS)[number]) {
  return { table: Prisma.raw(entry.table), column: Prisma.raw(entry.column) };
}

/**
 * Which of `blobNames` a stored reference still points at. Each column is
 * indexed, so this costs a few index lookups per name, whatever the size of
 * the tables. Pass a transaction to read under the locks it holds.
 */
export async function listAttachedBlobNames(
  client: QueryClient,
  blobNames: Iterable<string>,
): Promise<Set<string>> {
  const names = [...new Set(blobNames)];

  if (names.length === 0) {
    return new Set();
  }

  const selects = IMAGE_REFERENCE_COLUMNS.map((entry) => {
    const { table, column } = identifiers(entry);

    return Prisma.sql`SELECT ${column} AS name FROM ${table} WHERE ${column} IN (${Prisma.join(names)})`;
  });
  const rows = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.join(selects, " UNION ALL "),
  );

  return new Set(rows.map((row) => row.name));
}

/** Every stored image reference, with the source it came from. */
export function loadImageReferences(
  client: QueryClient,
): Promise<Array<{ source: ImageReferenceSource; name: string }>> {
  const selects = IMAGE_REFERENCE_COLUMNS.map((entry) => {
    const { table, column } = identifiers(entry);

    return Prisma.sql`SELECT ${entry.source} AS source, ${column} AS name FROM ${table} WHERE ${column} IS NOT NULL`;
  });

  return client.$queryRaw<
    Array<{ source: ImageReferenceSource; name: string }>
  >(Prisma.join(selects, " UNION ALL "));
}
