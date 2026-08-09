import ts from "typescript";
import {
  HTTP_METHODS as SUPPORTED_METHODS,
  WILDCARD_SEGMENT,
  type HttpMethod,
} from "@/openapi/coverage/shared";

const HTTP_METHODS = new Set<HttpMethod>(SUPPORTED_METHODS);

const API_ROUTE_PREFIX = "/api/v1";
const MAX_IDENTIFIER_RESOLUTION_DEPTH = 3;

export interface SourceDocument {
  readonly path: string;
  readonly source: string;
}

export type SuiteKind = "route-contract" | "persistence";
export type CoverageLevel = "explicit" | "smoke";

export type UnresolvedReason =
  | "non-literal-url"
  | "unresolvable-identifier"
  | "unresolvable-method"
  | "dynamic-origin"
  | "non-literal-each-table";

export interface ResolvedRequest {
  readonly method: HttpMethod;
  /** Path pattern with `*` for runtime holes, for example `/postings/*\/reviews`. */
  readonly pathPattern: string;
}

export interface RequestSite {
  readonly file: string;
  readonly line: number;
  readonly suite: SuiteKind;
  readonly level: CoverageLevel;
  /**
   * Correlated method/path pairs. An `it.each` table contributes one entry per
   * row rather than the cross product of its method and path columns.
   */
  readonly requests: readonly ResolvedRequest[];
  readonly rawUrlText: string;
  readonly resolution: "resolved" | "unresolved";
  readonly unresolvedReason?: UnresolvedReason;
}

export interface SkippedFile {
  readonly file: string;
  readonly reason: "no-route-composition";
}

export interface ExtractionResult {
  readonly sites: readonly RequestSite[];
  readonly skippedFiles: readonly SkippedFile[];
}

export interface ExtractionOptions {
  /** Repo-relative paths whose sites count as smoke probes only. */
  readonly smokeOnlyTestFiles?: readonly string[];
}

interface ResolvedPaths {
  readonly patterns?: string[];
  readonly unresolvedReason?: UnresolvedReason;
}

interface ResolvedMethods {
  readonly methods?: HttpMethod[];
  readonly unresolvedReason?: UnresolvedReason;
}

/** Values bound by an enclosing `it.each` / `test.each` tuple table. */
type EachBindings = Map<string, ts.Expression[]>;

interface Scope {
  readonly constants: Map<string, ts.Expression>;
  readonly each: EachBindings;
  /** Row index when expanding a correlated `it.each` table, otherwise null. */
  readonly rowIndex: number | null;
}

function walk(node: ts.Node, visit: (child: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function parse(document: SourceDocument): ts.SourceFile {
  return ts.createSourceFile(
    document.path,
    document.source,
    ts.ScriptTarget.Latest,
    true,
  );
}

function hasCallNamed(sourceFile: ts.SourceFile, names: string[]): boolean {
  let found = false;
  walk(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.includes(node.expression.text)
    ) {
      found = true;
    }
  });
  return found;
}

function toPosixPath(filePath: string): string {
  return filePath.split("\\").join("/");
}

function classifySuite(filePath: string): SuiteKind {
  const normalized = toPosixPath(filePath);
  return normalized.endsWith(".routes.integration.test.ts") ||
    normalized.endsWith(".mocked.integration.test.ts")
    ? "route-contract"
    : "persistence";
}

/**
 * Normalizes a concrete path string: drops the fragment and query, strips the
 * API prefix, and removes a trailing slash.
 */
export function normalizePathString(rawPath: string): string {
  let path = rawPath.split("#")[0]!.split("?")[0]!;

  const originMatch = /^https?:\/\/[^/]*/.exec(path);
  if (originMatch) {
    path = path.slice(originMatch[0].length);
  }

  if (path.startsWith(API_ROUTE_PREFIX)) {
    path = path.slice(API_ROUTE_PREFIX.length);
  }

  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  return path;
}

/** Collapses any segment containing a hole marker into a single `*`. */
function assemblePattern(parts: string[]): string {
  const joined = parts.join("");
  const [pathOnly] = joined.split("#");
  const withoutQuery = pathOnly!.split("?")[0]!;

  const segments = withoutQuery
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.includes("\u0000") ? WILDCARD_SEGMENT : segment,
    );

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

const HOLE_MARKER = "\u0000";

function collectConstants(
  sourceFile: ts.SourceFile,
): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();
  const ambiguousNames = new Set<string>();

  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) {
      return;
    }

    const declarationList = node.parent;
    if (
      !ts.isVariableDeclarationList(declarationList) ||
      (declarationList.flags & ts.NodeFlags.Const) === 0 ||
      !ts.isIdentifier(node.name)
    ) {
      return;
    }

    const name = node.name.text;

    // Lookup is file-wide rather than lexically scoped, so a name declared more
    // than once cannot be resolved unambiguously and is dropped entirely.
    if (constants.has(name) || ambiguousNames.has(name)) {
      constants.delete(name);
      ambiguousNames.add(name);
      return;
    }

    constants.set(name, node.initializer);
  });

  return constants;
}

/**
 * Builds the `it.each` / `test.each` tuple bindings in scope for a request site,
 * keeping columns correlated by row.
 */
function findEachTable(
  node: ts.Node,
): { parameters: string[]; rows: ts.Expression[][] } | null {
  let current: ts.Node | undefined = node;

  while (current) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      ts.isCallExpression(current.parent)
    ) {
      const outerCall = current.parent;
      const callee = outerCall.expression;

      if (ts.isCallExpression(callee)) {
        const eachTarget = callee.expression;
        const isEach =
          ts.isPropertyAccessExpression(eachTarget) &&
          eachTarget.name.text === "each";

        if (isEach) {
          const table = callee.arguments[0];
          if (table && ts.isArrayLiteralExpression(table)) {
            const parameters = current.parameters
              .map((parameter) =>
                ts.isIdentifier(parameter.name) ? parameter.name.text : "",
              )
              .filter((name) => name.length > 0);

            const rows: ts.Expression[][] = [];
            for (const element of table.elements) {
              if (!ts.isArrayLiteralExpression(element)) {
                return { parameters, rows: [] };
              }
              rows.push([...element.elements]);
            }

            return { parameters, rows };
          }
        }
      }
    }

    current = current.parent;
  }

  return null;
}

function resolveUrlExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: Scope,
  depth = 0,
  /**
   * True for the URL argument itself. At that level an unresolvable hole covers
   * the whole path, so nothing can be claimed; nested inside `buildApiPath` a
   * hole is just one path parameter and becomes a wildcard segment.
   */
  isOrigin = false,
): ResolvedPaths {
  if (depth > MAX_IDENTIFIER_RESOLUTION_DEPTH) {
    return { unresolvedReason: "unresolvable-identifier" };
  }

  if (ts.isIdentifier(node)) {
    const eachValues = scope.each.get(node.text);
    if (eachValues) {
      const value =
        scope.rowIndex === null ? undefined : eachValues[scope.rowIndex];
      if (!value) {
        return { unresolvedReason: "non-literal-each-table" };
      }
      return resolveUrlExpression(value, sourceFile, scope, depth + 1, isOrigin);
    }

    const binding = scope.constants.get(node.text);
    if (!binding) {
      return { unresolvedReason: "unresolvable-identifier" };
    }
    return resolveUrlExpression(binding, sourceFile, scope, depth + 1, isOrigin);
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { patterns: [assemblePattern([normalizePathString(node.text)])] };
  }

  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const isBuildApiPath =
      ts.isIdentifier(callee) && callee.text === "buildApiPath";

    if (isBuildApiPath) {
      const argument = node.arguments[0];
      if (!argument) {
        return { unresolvedReason: "non-literal-url" };
      }
      return resolveUrlExpression(argument, sourceFile, scope, depth + 1);
    }

    return { unresolvedReason: "non-literal-url" };
  }

  if (ts.isTemplateExpression(node)) {
    return resolveTemplate(node, sourceFile, scope, depth, isOrigin);
  }

  return { unresolvedReason: "non-literal-url" };
}

function resolveTemplate(
  node: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
  scope: Scope,
  depth: number,
  isOrigin: boolean,
): ResolvedPaths {
  const parts: string[] = [];
  let head = node.head.text;

  // Strip an absolute origin such as `http://rent.test`.
  const originMatch = /^https?:\/\/[^/]+/.exec(head);
  if (originMatch) {
    head = head.slice(originMatch[0].length);
  } else if (head.length === 0) {
    // The template opens with a hole, so the origin itself is dynamic.
    return { unresolvedReason: "dynamic-origin" };
  }

  parts.push(head);

  for (const span of node.templateSpans) {
    const resolved = resolveUrlExpression(
      span.expression,
      sourceFile,
      scope,
      depth + 1,
    );

    if (resolved.patterns && resolved.patterns.length === 1) {
      parts.push(resolved.patterns[0]!);
    } else if (isOrigin) {
      // This span carries the whole path, so an unresolvable value means the
      // request target is unknown rather than merely parameterised.
      return {
        unresolvedReason: resolved.unresolvedReason ?? "non-literal-url",
      };
    } else {
      // An opaque runtime value: one path segment we cannot pin down.
      parts.push(HOLE_MARKER);
    }

    parts.push(span.literal.text);
  }

  return { patterns: [assemblePattern(parts)] };
}

function resolveMethods(
  initArgument: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  scope: Scope,
): ResolvedMethods {
  if (!initArgument) {
    return { methods: ["GET"] };
  }

  if (!ts.isObjectLiteralExpression(initArgument)) {
    return { unresolvedReason: "unresolvable-method" };
  }

  for (const property of initArgument.properties) {
    if (ts.isSpreadAssignment(property)) {
      return { unresolvedReason: "unresolvable-method" };
    }
  }

  for (const property of initArgument.properties) {
    // `{ method: "POST" }`
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "method"
    ) {
      return resolveMethodExpression(property.initializer, sourceFile, scope);
    }

    // `{ method }` shorthand, which is how `it.each` tables pass the method.
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === "method"
    ) {
      return resolveMethodExpression(property.name, sourceFile, scope);
    }
  }

  // No `method` key at all: Hono defaults to GET.
  return { methods: ["GET"] };
}

function resolveMethodExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  scope: Scope,
  depth = 0,
): ResolvedMethods {
  if (depth > MAX_IDENTIFIER_RESOLUTION_DEPTH) {
    return { unresolvedReason: "unresolvable-method" };
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const method = node.text.toUpperCase() as HttpMethod;
    return HTTP_METHODS.has(method)
      ? { methods: [method] }
      : { unresolvedReason: "unresolvable-method" };
  }

  if (ts.isConditionalExpression(node)) {
    const whenTrue = resolveMethodExpression(
      node.whenTrue,
      sourceFile,
      scope,
      depth + 1,
    );
    const whenFalse = resolveMethodExpression(
      node.whenFalse,
      sourceFile,
      scope,
      depth + 1,
    );

    if (!whenTrue.methods || !whenFalse.methods) {
      return { unresolvedReason: "unresolvable-method" };
    }

    return { methods: [...new Set([...whenTrue.methods, ...whenFalse.methods])] };
  }

  if (ts.isIdentifier(node)) {
    const eachValues = scope.each.get(node.text);
    if (eachValues) {
      const value =
        scope.rowIndex === null ? undefined : eachValues[scope.rowIndex];
      if (!value) {
        return { unresolvedReason: "non-literal-each-table" };
      }
      return resolveMethodExpression(value, sourceFile, scope, depth + 1);
    }

    const binding = scope.constants.get(node.text);
    if (!binding) {
      return { unresolvedReason: "unresolvable-method" };
    }
    return resolveMethodExpression(binding, sourceFile, scope, depth + 1);
  }

  return { unresolvedReason: "unresolvable-method" };
}

export function extractRequestSites(
  documents: readonly SourceDocument[],
  options: ExtractionOptions = {},
): ExtractionResult {
  const smokeOnly = new Set(
    (options.smokeOnlyTestFiles ?? []).map((entry) => toPosixPath(entry)),
  );

  const sites: RequestSite[] = [];
  const skippedFiles: SkippedFile[] = [];

  for (const document of documents) {
    const sourceFile = parse(document);

    // The same composition predicate the controller check used: a file only
    // proves endpoint behaviour if it mounts production routes.
    if (
      !hasCallNamed(sourceFile, [
        "createRouteTestApp",
        "mountRoutes",
        "createPersistenceTestApp",
      ])
    ) {
      skippedFiles.push({
        file: toPosixPath(document.path),
        reason: "no-route-composition",
      });
      continue;
    }

    const file = toPosixPath(document.path);
    const suite = classifySuite(document.path);
    const level: CoverageLevel = [...smokeOnly].some((entry) =>
      file.endsWith(entry),
    )
      ? "smoke"
      : "explicit";
    const constants = collectConstants(sourceFile);

    walk(sourceFile, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== "request"
      ) {
        return;
      }

      const urlArgument = node.arguments[0];
      if (!urlArgument) {
        return;
      }

      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      const rawUrlText = urlArgument.getText(sourceFile).replace(/\s+/g, " ");

      const eachTable = findEachTable(node);
      const rowCount = eachTable && eachTable.rows.length > 0 ? eachTable.rows.length : 1;

      const requests = new Map<string, ResolvedRequest>();
      let unresolvedReason: UnresolvedReason | undefined;

      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const each: EachBindings = new Map();
        if (eachTable) {
          if (eachTable.rows.length === 0) {
            unresolvedReason = "non-literal-each-table";
            break;
          }
          eachTable.parameters.forEach((parameter, columnIndex) => {
            // Kept index-aligned with `rows` so a site expands to one
            // (method, path) pair per row rather than the cross product.
            each.set(
              parameter,
              eachTable.rows.map((row) => row[columnIndex]) as ts.Expression[],
            );
          });
        }

        const scope: Scope = {
          constants,
          each,
          rowIndex: eachTable ? rowIndex : null,
        };

        const resolvedPaths = resolveUrlExpression(
          urlArgument,
          sourceFile,
          scope,
          0,
          true,
        );
        const resolvedMethods = resolveMethods(
          node.arguments[1],
          sourceFile,
          scope,
        );

        if (!resolvedPaths.patterns) {
          unresolvedReason = resolvedPaths.unresolvedReason ?? "non-literal-url";
          break;
        }
        if (!resolvedMethods.methods) {
          unresolvedReason =
            resolvedMethods.unresolvedReason ?? "unresolvable-method";
          break;
        }

        // Correlated within a row: every method this row can take, paired with
        // every path this row can take. Rows never cross-pollinate.
        for (const method of resolvedMethods.methods) {
          for (const pathPattern of resolvedPaths.patterns) {
            requests.set(`${method} ${pathPattern}`, { method, pathPattern });
          }
        }
      }

      if (unresolvedReason) {
        sites.push({
          file,
          line,
          suite,
          level,
          requests: [],
          rawUrlText,
          resolution: "unresolved",
          unresolvedReason,
        });
        return;
      }

      sites.push({
        file,
        line,
        suite,
        level,
        requests: [...requests.values()],
        rawUrlText,
        resolution: "resolved",
      });
    });
  }

  return { sites, skippedFiles };
}
