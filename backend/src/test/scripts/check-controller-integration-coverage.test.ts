import {
  discoverControllerCoverage,
  discoverRegisteredControllers,
  type SourceDocument,
} from "@/scripts/check-controller-integration-coverage";

const routeModule: SourceDocument = {
  path: "example.routes.ts",
  source: `
    import type { ExampleController } from "@/features/example/example.controller";
    resolveHandler<ExampleController>(containerTokens.exampleController, "list");
  `,
};

function coverageFor(source: string) {
  const controllers = discoverRegisteredControllers([routeModule]);
  return discoverControllerCoverage(controllers, [
    { path: "example.routes.integration.test.ts", source },
  ]);
}

describe("controller integration coverage analysis", () => {
  it("accepts an instantiated controller exercised through a mounted HTTP app", () => {
    const coverage = coverageFor(`
      import { ExampleController } from "@/features/example/example.controller";
      const controller = new ExampleController({});
      const app = createRouteTestApp(new Map());
      await app.request("/examples");
    `);

    expect(coverage[0]?.qualifyingTests).toEqual([
      "example.routes.integration.test.ts",
    ]);
  });

  it("reports a registered controller with no qualifying test", () => {
    const controllers = discoverRegisteredControllers([routeModule]);
    const coverage = discoverControllerCoverage(controllers, []);

    expect(coverage[0]?.qualifyingTests).toEqual([]);
  });

  it("rejects a direct handler test that does not mount production routes", () => {
    const coverage = coverageFor(`
      import { ExampleController } from "@/features/example/example.controller";
      const controller = new ExampleController({});
      await app.request("/examples");
    `);

    expect(coverage[0]?.qualifyingTests).toEqual([]);
  });

  it("rejects a mounted app test without an HTTP request", () => {
    const coverage = coverageFor(`
      import { ExampleController } from "@/features/example/example.controller";
      const controller = new ExampleController({});
      createRouteTestApp(new Map());
    `);

    expect(coverage[0]?.qualifyingTests).toEqual([]);
  });
});
