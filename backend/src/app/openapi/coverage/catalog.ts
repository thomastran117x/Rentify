import {
  buildOperationKey,
  splitPathSegments,
  type HttpMethod,
  type PathSegment,
} from "@/openapi/coverage/shared";

const OPENAPI_HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch"]);

export interface OperationCatalogEntry {
  /** Stable identity used across the report, for example `POST /postings/{id}/reviews`. */
  readonly key: string;
  readonly method: HttpMethod;
  /** Prefix-free OpenAPI path, for example `/postings/{id}/reviews`. */
  readonly path: string;
  readonly operationId: string;
  readonly tags: readonly string[];
  readonly segments: readonly PathSegment[];
}

/**
 * Flattens an OpenAPI document into the operation inventory that coverage is
 * measured against.
 */
export function buildOperationCatalog(
  document: Record<string, unknown>,
): OperationCatalogEntry[] {
  const paths = document.paths;
  if (typeof paths !== "object" || paths === null) {
    throw new Error("OpenAPI document must include a paths object.");
  }

  const entries: OperationCatalogEntry[] = [];

  for (const [path, pathItem] of Object.entries(
    paths as Record<string, unknown>,
  )) {
    if (typeof pathItem !== "object" || pathItem === null) {
      throw new Error(`Path item for ${path} must be an object.`);
    }

    if (path.includes("*")) {
      // Segment-count matching assumes no variadic paths. Fail loudly rather
      // than silently under-reporting if that ever changes.
      throw new Error(
        `OpenAPI path '${path}' uses a wildcard, which the coverage matcher does not support.`,
      );
    }

    for (const [method, operation] of Object.entries(
      pathItem as Record<string, unknown>,
    )) {
      if (!OPENAPI_HTTP_METHODS.has(method)) {
        continue;
      }

      const operationRecord = operation as Record<string, unknown>;
      const upperMethod = method.toUpperCase() as HttpMethod;

      entries.push({
        key: buildOperationKey(upperMethod, path),
        method: upperMethod,
        path,
        operationId:
          typeof operationRecord.operationId === "string"
            ? operationRecord.operationId
            : "",
        tags: Array.isArray(operationRecord.tags)
          ? operationRecord.tags.filter(
              (tag): tag is string => typeof tag === "string",
            )
          : [],
        segments: splitPathSegments(path),
      });
    }
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

export type { HttpMethod, PathSegment };
