import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { buildOpenApiDocument, buildOpenApiYaml } from "@/openapi/spec";
import { getOpenApiSpecFilePath, readOpenApiSpecFile } from "@/openapi/file";

const ROUTE_MODULE_DIRECTORY = resolve(
  process.cwd(),
  "src",
  "app",
  "configuration",
  "bootstrap",
  "routes",
  "modules",
);

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch"]);

export interface RouteSignature {
  method: string;
  path: string;
}

function normalizeRoutePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function assertRecord(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function resolveReference(
  document: Record<string, unknown>,
  ref: string,
): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported external reference: ${ref}`);
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current: unknown = document;

  for (const segment of segments) {
    assertRecord(current, `Reference target is not an object for ${ref}.`);

    if (!(segment in current)) {
      throw new Error(`Unresolved reference: ${ref}`);
    }

    current = current[segment];
  }

  return current;
}

function walkReferences(
  node: unknown,
  visit: (ref: string) => void,
  seen = new Set<unknown>(),
): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (seen.has(node)) {
    return;
  }

  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkReferences(item, visit, seen);
    }

    return;
  }

  const record = node as Record<string, unknown>;

  if (typeof record.$ref === "string") {
    visit(record.$ref);
  }

  for (const value of Object.values(record)) {
    walkReferences(value, visit, seen);
  }
}

function collectOpenApiOperations(
  document: Record<string, unknown>,
): RouteSignature[] {
  assertRecord(document.paths, "OpenAPI document must include a paths object.");

  const operations: RouteSignature[] = [];

  for (const [path, value] of Object.entries(document.paths)) {
    assertRecord(value, `Path item for ${path} must be an object.`);

    for (const [method, operation] of Object.entries(value)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      assertRecord(
        operation,
        `Operation ${method.toUpperCase()} ${path} must be an object.`,
      );

      operations.push({
        method: method.toUpperCase(),
        path,
      });
    }
  }

  return operations;
}

function validateOperationExamples(
  path: string,
  method: string,
  operation: Record<string, unknown>,
): void {
  const requestBody = operation.requestBody as
    | Record<string, unknown>
    | undefined;

  if (operation.requestBody) {
    assertRecord(
      requestBody,
      `Request body for ${method.toUpperCase()} ${path} must be an object.`,
    );
    assertRecord(
      requestBody.content,
      `Request body content for ${method.toUpperCase()} ${path} must be an object.`,
    );

    const jsonContent = requestBody.content["application/json"] as
      | Record<string, unknown>
      | undefined;

    if (jsonContent) {
      if (!("example" in jsonContent) && !("examples" in jsonContent)) {
        throw new Error(
          `Request body for ${method.toUpperCase()} ${path} must include an example.`,
        );
      }
    }
  }

  const responses = operation.responses;

  assertRecord(
    responses,
    `Responses for ${method.toUpperCase()} ${path} must be an object.`,
  );

  const primarySuccessStatus =
    ["200", "201", "202"].find((status) => status in responses) ?? null;

  if (!primarySuccessStatus) {
    return;
  }

  const response = responses[primarySuccessStatus];
  assertRecord(
    response,
    `Primary success response for ${method.toUpperCase()} ${path} must be an object.`,
  );

  if (!response.content) {
    return;
  }

  assertRecord(
    response.content,
    `Response content for ${method.toUpperCase()} ${path} must be an object.`,
  );

  const jsonContent = response.content["application/json"] as
    | Record<string, unknown>
    | undefined;

  if (
    jsonContent &&
    !("example" in jsonContent) &&
    !("examples" in jsonContent)
  ) {
    throw new Error(
      `Primary success response for ${method.toUpperCase()} ${path} must include an example.`,
    );
  }
}

export function validateOpenApiDocumentStructure(
  document: Record<string, unknown>,
): void {
  if (document.openapi !== "3.1.0") {
    throw new Error("OpenAPI document must declare openapi: 3.1.0.");
  }

  assertRecord(document.info, "OpenAPI document must include an info object.");

  if (typeof document.info.title !== "string" || !document.info.title.trim()) {
    throw new Error("OpenAPI info.title must be a non-empty string.");
  }

  if (
    typeof document.info.version !== "string" ||
    !document.info.version.trim()
  ) {
    throw new Error("OpenAPI info.version must be a non-empty string.");
  }

  assertRecord(document.paths, "OpenAPI document must include a paths object.");

  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!path.startsWith("/")) {
      throw new Error(`OpenAPI path keys must start with '/': ${path}`);
    }

    assertRecord(pathItem, `Path item for ${path} must be an object.`);

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      assertRecord(
        operation,
        `Operation ${method.toUpperCase()} ${path} must be an object.`,
      );

      if (
        typeof operation.summary !== "string" ||
        operation.summary.trim().length === 0
      ) {
        throw new Error(
          `Operation ${method.toUpperCase()} ${path} must include a summary.`,
        );
      }

      if (
        typeof operation.operationId !== "string" ||
        operation.operationId.trim().length === 0
      ) {
        throw new Error(
          `Operation ${method.toUpperCase()} ${path} must include an operationId.`,
        );
      }

      if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
        throw new Error(
          `Operation ${method.toUpperCase()} ${path} must include at least one tag.`,
        );
      }

      if (!operation["x-rentify-permissions"]) {
        throw new Error(
          `Operation ${method.toUpperCase()} ${path} must include x-rentify-permissions.`,
        );
      }

      const responses = operation.responses;

      if (!responses) {
        throw new Error(
          `Operation ${method.toUpperCase()} ${path} must include responses.`,
        );
      }

      validateOperationExamples(path, method, operation);
    }
  }

  walkReferences(document, (ref) => {
    void resolveReference(document, ref);
  });
}

export async function discoverRegisteredRoutes(): Promise<RouteSignature[]> {
  const files = await readdir(ROUTE_MODULE_DIRECTORY);
  const routeSignatures: RouteSignature[] = [];

  for (const filename of files.filter((name) => name.endsWith(".ts"))) {
    const absolutePath = resolve(ROUTE_MODULE_DIRECTORY, filename);
    const contents = await readFile(absolutePath, "utf8");
    const regex = /app\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g;

    for (const match of contents.matchAll(regex)) {
      routeSignatures.push({
        method: match[1].toUpperCase(),
        path: normalizeRoutePath(match[2]),
      });
    }
  }

  return routeSignatures.sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(
      `${right.method} ${right.path}`,
    ),
  );
}

export async function validateOpenApiRouteCoverage(
  document: Record<string, unknown>,
): Promise<void> {
  const documentedRoutes = collectOpenApiOperations(document)
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  const discoveredRoutes = (await discoverRegisteredRoutes())
    .map((route) => `${route.method} ${route.path}`)
    .sort();

  const missingFromSpec = discoveredRoutes.filter(
    (route) => !documentedRoutes.includes(route),
  );
  const missingFromRoutes = documentedRoutes.filter(
    (route) => !discoveredRoutes.includes(route),
  );

  if (missingFromSpec.length > 0 || missingFromRoutes.length > 0) {
    throw new Error(
      [
        "OpenAPI route coverage mismatch detected.",
        missingFromSpec.length > 0
          ? `Missing from spec: ${missingFromSpec.join(", ")}`
          : null,
        missingFromRoutes.length > 0
          ? `Missing from route modules: ${missingFromRoutes.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

export async function validateOpenApiFileContents(): Promise<void> {
  const expectedYaml = buildOpenApiYaml();
  const actualYaml = await readOpenApiSpecFile();

  if (actualYaml !== expectedYaml) {
    throw new Error(
      `OpenAPI YAML file is stale. Regenerate ${getOpenApiSpecFilePath()}.`,
    );
  }

  const parsed = yaml.load(actualYaml);
  assertRecord(parsed, "OpenAPI YAML must parse to an object.");
  validateOpenApiDocumentStructure(parsed);
}

export async function runOpenApiChecks(): Promise<void> {
  const document = buildOpenApiDocument();
  validateOpenApiDocumentStructure(document);
  await validateOpenApiRouteCoverage(document);
  await validateOpenApiFileContents();
}

export function buildReference(pointer: string[]): string {
  return `#/${pointer.map(escapeJsonPointerSegment).join("/")}`;
}
