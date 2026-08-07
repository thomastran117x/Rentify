import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type SourceDocument = {
  path: string;
  source: string;
};

export type RegisteredController = {
  className: string;
  modulePath: string;
};

export type ControllerCoverage = RegisteredController & {
  qualifyingTests: string[];
};

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

export function discoverRegisteredControllers(
  routeModules: SourceDocument[],
): RegisteredController[] {
  const controllers = new Map<string, RegisteredController>();

  for (const document of routeModules) {
    const sourceFile = parse(document);
    const controllerImports = new Map<string, RegisteredController>();

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) {
        continue;
      }

      const modulePath = statement.moduleSpecifier
        .getText(sourceFile)
        .slice(1, -1);
      const namedBindings = statement.importClause.namedBindings;
      if (
        !modulePath.endsWith(".controller") ||
        !namedBindings ||
        !ts.isNamedImports(namedBindings)
      ) {
        continue;
      }

      for (const element of namedBindings.elements) {
        const className = element.name.text;
        if (className.endsWith("Controller")) {
          controllerImports.set(className, { className, modulePath });
        }
      }
    }

    walk(sourceFile, (node) => {
      if (
        !ts.isCallExpression(node) ||
        node.expression.getText(sourceFile) !== "resolveHandler"
      ) {
        return;
      }

      const typeArgument = node.typeArguments?.[0];
      if (!typeArgument || !ts.isTypeReferenceNode(typeArgument)) return;

      const className = typeArgument.typeName.getText(sourceFile);
      const controller = controllerImports.get(className);
      if (controller) controllers.set(controller.modulePath, controller);
    });
  }

  return [...controllers.values()].sort((left, right) =>
    left.className.localeCompare(right.className),
  );
}

function hasCallNamed(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false;
  walk(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = true;
    }
  });
  return found;
}

function hasHttpRequest(sourceFile: ts.SourceFile): boolean {
  let found = false;
  walk(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "request"
    ) {
      found = true;
    }
  });
  return found;
}

export function discoverControllerCoverage(
  controllers: RegisteredController[],
  testDocuments: SourceDocument[],
): ControllerCoverage[] {
  const coveredByModule = new Map<string, Set<string>>();

  for (const testDocument of testDocuments) {
    const sourceFile = parse(testDocument);
    if (
      !hasHttpRequest(sourceFile) ||
      (!hasCallNamed(sourceFile, "createRouteTestApp") &&
        !hasCallNamed(sourceFile, "mountRoutes"))
    ) {
      continue;
    }

    const importedControllers = new Map<string, string>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause)
        continue;
      const modulePath = statement.moduleSpecifier
        .getText(sourceFile)
        .slice(1, -1);
      const bindings = statement.importClause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        importedControllers.set(element.name.text, modulePath);
      }
    }

    const instantiated = new Set<string>();
    walk(sourceFile, (node) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        instantiated.add(node.expression.text);
      }
    });

    for (const className of instantiated) {
      const modulePath = importedControllers.get(className);
      if (!modulePath) continue;
      const covered = coveredByModule.get(modulePath) ?? new Set<string>();
      covered.add(testDocument.path);
      coveredByModule.set(modulePath, covered);
    }
  }

  return controllers.map((controller) => ({
    ...controller,
    qualifyingTests: [
      ...(coveredByModule.get(controller.modulePath) ?? []),
    ].sort(),
  }));
}

function readDocuments(
  directory: string,
  predicate: (path: string) => boolean,
): SourceDocument[] {
  const documents: SourceDocument[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      documents.push(...readDocuments(filePath, predicate));
    } else if (entry.isFile() && predicate(filePath)) {
      documents.push({
        path: filePath,
        source: readFileSync(filePath, "utf8"),
      });
    }
  }
  return documents;
}

export function main(projectRoot = process.cwd()): void {
  const routeModuleDirectory = join(
    projectRoot,
    "src/app/configuration/bootstrap/routes/modules",
  );
  const testDirectory = join(projectRoot, "src/test");
  const controllers = discoverRegisteredControllers(
    readDocuments(routeModuleDirectory, (path) => path.endsWith(".routes.ts")),
  );
  const coverage = discoverControllerCoverage(
    controllers,
    readDocuments(
      testDirectory,
      (path) =>
        path.endsWith(".routes.integration.test.ts") ||
        path.endsWith(".mocked.integration.test.ts"),
    ),
  );
  const missing = coverage.filter(
    (controller) => controller.qualifyingTests.length === 0,
  );

  if (missing.length === 0) {
    console.log(
      `Controller integration coverage passed (${coverage.length} registered controllers).`,
    );
    return;
  }

  console.error("Controllers missing qualifying HTTP integration coverage:");
  for (const controller of missing) {
    console.error(`- ${controller.className} (${controller.modulePath})`);
  }
  console.error(
    "A qualifying test must import and instantiate the controller, mount production routes via createRouteTestApp or mountRoutes, and call app.request(...).",
  );
  process.exitCode = 1;
}
