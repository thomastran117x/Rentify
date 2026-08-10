export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
];

/** Marks a path segment produced by a template-literal expression hole. */
export const WILDCARD_SEGMENT = "*";

export type PathSegment =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "parameter"; readonly name: string };

export function buildOperationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function splitPathSegments(path: string): PathSegment[] {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const parameterMatch = /^\{(.+)\}$/.exec(segment);
      return parameterMatch
        ? { kind: "parameter" as const, name: parameterMatch[1]! }
        : { kind: "literal" as const, value: segment };
    });
}
