import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_REFERENCE_COLUMNS,
  listAttachedBlobNames,
  loadImageReferences,
} from "@/features/blob/image-references";

// Tables whose `*_blob_name` columns are not references a feature displays:
// the media table names its own upload and processed image, and the audit
// table records names a restorable entry holds, which the cleanups read
// separately.
const NOT_REFERENCES = new Set(["media", "organization_audit_blob_references"]);

interface SchemaTable {
  columns: Map<string, string>;
  indexedColumns: Set<string>;
}

/** Each table's columns (field name to column name) and leading index columns. */
function readSchemaTables(): Map<string, SchemaTable> {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const tables = new Map<string, SchemaTable>();

  for (const [, body] of schema.matchAll(/^model \w+ \{\n([\s\S]*?)\n\}/gm)) {
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1];

    if (!table) {
      continue;
    }

    const columns = new Map<string, string>();

    for (const [, field, column] of body.matchAll(
      /^\s+(\w+)\s+\S+.*@map\("([^"]+)"\)/gm,
    )) {
      columns.set(field, column);
    }

    const indexedColumns = new Set<string>();

    for (const [, firstField] of body.matchAll(
      /@@(?:index|unique)\(\[(\w+)/g,
    )) {
      indexedColumns.add(columns.get(firstField) ?? firstField);
    }

    tables.set(table, { columns, indexedColumns });
  }

  return tables;
}

describe("image reference registry", () => {
  const tables = readSchemaTables();

  it("lists every image column in the schema", () => {
    const registered = new Set(
      IMAGE_REFERENCE_COLUMNS.map(({ table, column }) => `${table}.${column}`),
    );
    const imageColumns = [...tables.entries()].flatMap(
      ([table, { columns }]) =>
        NOT_REFERENCES.has(table)
          ? []
          : [...columns.values()]
              .filter((column) => column.endsWith("_blob_name"))
              .map((column) => `${table}.${column}`),
    );

    // A sanity check that the parser found the schema's image columns at all.
    expect(imageColumns).toContain("profiles.avatar_blob_name");
    expect(imageColumns.filter((column) => !registered.has(column))).toEqual(
      [],
    );
  });

  it("indexes every registered column, so a lookup by name stays cheap", () => {
    for (const { table, column } of IMAGE_REFERENCE_COLUMNS) {
      expect({
        column: `${table}.${column}`,
        indexed: tables.get(table)?.indexedColumns.has(column) ?? false,
      }).toEqual({ column: `${table}.${column}`, indexed: true });
    }
  });

  it("asks every column which names it references, in one query", async () => {
    const queryRaw = jest.fn(async (_query: unknown) => [
      { name: "media/images/u/a.webp" },
      { name: "media/images/u/a.webp" },
    ]);

    await expect(
      listAttachedBlobNames({ $queryRaw: queryRaw } as never, [
        "media/images/u/a.webp",
        "media/images/u/b.webp",
        "media/images/u/a.webp",
      ]),
    ).resolves.toEqual(new Set(["media/images/u/a.webp"]));

    const [[query]] = queryRaw.mock.calls as unknown as [
      [{ sql: string; values: unknown[] }],
    ];
    expect(query.sql.split(" UNION ALL ")).toHaveLength(
      IMAGE_REFERENCE_COLUMNS.length,
    );
    // Each name is a bound parameter, sent once per column.
    expect(query.values).toEqual(
      IMAGE_REFERENCE_COLUMNS.flatMap(() => [
        "media/images/u/a.webp",
        "media/images/u/b.webp",
      ]),
    );

    await expect(
      listAttachedBlobNames({ $queryRaw: queryRaw } as never, []),
    ).resolves.toEqual(new Set());
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("loads every stored reference tagged with its source", async () => {
    const rows = [{ source: "profiles", name: "media/images/u/a.webp" }];
    const queryRaw = jest.fn(async (_query: unknown) => rows);

    await expect(
      loadImageReferences({ $queryRaw: queryRaw } as never),
    ).resolves.toBe(rows);

    const [[query]] = queryRaw.mock.calls as unknown as [
      [{ sql: string; values: unknown[] }],
    ];
    expect(query.values).toEqual(
      IMAGE_REFERENCE_COLUMNS.map(({ source }) => source),
    );
  });
});
