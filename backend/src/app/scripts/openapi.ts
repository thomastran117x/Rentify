import {
  writeOpenApiJsonSpecFile,
  writeOpenApiYamlSpecFile,
} from "@/openapi/file";
import {
  runOpenApiChecks,
  validateOpenApiRouteCoverage,
  validateOpenApiDocumentStructure,
} from "@/openapi/validation";
import {
  buildOpenApiDocument,
  buildOpenApiJson,
  buildOpenApiYaml,
} from "@/openapi/spec";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const shouldWrite = args.has("--write");
  const document = buildOpenApiDocument();

  validateOpenApiDocumentStructure(document);
  await validateOpenApiRouteCoverage(document);

  if (shouldWrite) {
    await Promise.all([
      writeOpenApiYamlSpecFile(buildOpenApiYaml()),
      writeOpenApiJsonSpecFile(buildOpenApiJson()),
    ]);
  }

  await runOpenApiChecks();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
